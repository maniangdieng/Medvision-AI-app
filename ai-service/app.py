"""
MedVision IA — Service d'inférence (BioMedCLIP + MedGemma 4B-IT)

Portage du notebook d'origine (interface Gradio) en API REST.
Ce service ne contient AUCUNE donnée patient persistante : il reçoit des
images, renvoie un rapport, et oublie tout. Les comptes, patients et
rapports vivent dans le backend NestJS.

Lancement :
    MEDVISION_API_KEY=xxxx HF_TOKEN=hf_xxx uvicorn app:app --host 0.0.0.0 --port 8000
"""

import gc
import io
import os
import re
import secrets
import tempfile
import time
import zipfile
from datetime import datetime
from typing import List, Optional

import numpy as np
import torch
import torch.nn.functional as F
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from PIL import Image as PILImage

os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────
# strip() : une espace ou un retour à la ligne collé dans le secret Colab suffit à tout refuser
API_KEY = os.environ.get("MEDVISION_API_KEY", "").strip()
HF_TOKEN = os.environ.get("HF_TOKEN")
SEUIL_CLIP = float(os.environ.get("SEUIL_CLIP", "0.25"))
MAX_FINDINGS = 5
MAX_IMAGES = int(os.environ.get("MAX_IMAGES", "40"))
MAX_FILE_MB = int(os.environ.get("MAX_FILE_MB", "50"))
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

BIOMEDCLIP_REPO = "microsoft/BiomedCLIP-PubMedBERT_256-vit_base_patch16_224"
MEDGEMMA_ID = "google/medgemma-4b-it"

if not API_KEY:
    # Pas de clé = refus de démarrer : on n'expose jamais un modèle médical ouvert.
    raise RuntimeError("MEDVISION_API_KEY doit être défini avant de lancer le service.")


def _nb_coeurs():
    """Cœurs réellement alloués. Dans un conteneur, os.cpu_count() voit souvent tous les cœurs
    de la machine hôte : torch lance alors des dizaines de threads qui se gênent."""
    if os.environ.get("TORCH_THREADS"):
        return int(os.environ["TORCH_THREADS"])
    try:
        quota, periode = open("/sys/fs/cgroup/cpu.max").read().split()
        if quota != "max":
            return max(1, int(quota) // int(periode))
    except (OSError, ValueError):
        pass
    return os.cpu_count() or 1


def _cpu_bf16_natif():
    """Le processeur calcule-t-il en bfloat16 nativement (AVX512-BF16 ou AMX) ? Sinon il l'émule, très lentement."""
    try:
        drapeaux = open("/proc/cpuinfo").read()
    except OSError:
        return False
    return "avx512_bf16" in drapeaux or "amx_bf16" in drapeaux


if DEVICE == "cpu":
    torch.set_num_threads(_nb_coeurs())
# MedGemma est publié en bfloat16 : c'est sa précision d'origine (pas une compression). Le float32 ne sert
# que de repli sur un CPU sans bfloat16 natif, et coûte deux fois plus de lecture mémoire par mot généré.
DTYPE = torch.bfloat16 if DEVICE == "cuda" or _cpu_bf16_natif() else torch.float32
# Plafond de sécurité seulement : le modèle s'arrête de lui-même une fois le rapport terminé.
MAX_NOUVEAUX_TOKENS = int(os.environ.get("MAX_NOUVEAUX_TOKENS", "1000"))
# transformers pénalise aussi les mots du prompt : à 1.1, un long prompt français poussait le modèle à abréger
# (et à basculer vers l'anglais). 1.03 évite encore les boucles sans brider le vocabulaire médical.
PENALITE_REPETITION = float(os.environ.get("PENALITE_REPETITION", "1.03"))
# « Prompt lookup decoding » : les mots suivants sont devinés en recopiant une suite déjà présente dans le prompt
# (titres, structures anatomiques…) puis vérifiés par MedGemma en UNE passe. Sur CPU, une passe coûte presque
# autant pour 10 mots que pour 1 (c'est la lecture des poids qui limite) ; en décodage glouton le texte obtenu
# est identique. 0 = désactivé.
PROMPT_LOOKUP = int(os.environ.get("PROMPT_LOOKUP", "10"))

# ─────────────────────────────────────────────────────────────────────────────
# Chargement des modèles (Blocs 4 et 5 du notebook)
# ─────────────────────────────────────────────────────────────────────────────
import open_clip  # noqa: E402
from transformers import AutoModelForImageTextToText, AutoProcessor  # noqa: E402

# Correction par rapport au notebook : celui-ci créait une architecture
# « ViT-B-16 » générique puis chargeait les poids avec strict=False, ce qui
# laissait 301 poids manquants (encodeur texte PubMedBERT non chargé = aléatoire).
# Le chargement officiel « hf-hub: » construit la bonne architecture.
print("Chargement BioMedCLIP...")
biomedclip_model, _, biomedclip_preprocess = open_clip.create_model_and_transforms(
    "hf-hub:" + BIOMEDCLIP_REPO
)
biomedclip_model = biomedclip_model.to(DEVICE).eval()
biomedclip_tokenizer = open_clip.get_tokenizer("hf-hub:" + BIOMEDCLIP_REPO)
print(f"BioMedCLIP chargé sur {DEVICE}")

print(f"Chargement MedGemma 4B-IT ({str(DTYPE).replace('torch.', '')}, sans quantification, "
      f"{DEVICE}, {torch.get_num_threads()} threads)...")
medgemma_processor = AutoProcessor.from_pretrained(MEDGEMMA_ID, token=HF_TOKEN)
medgemma_model = AutoModelForImageTextToText.from_pretrained(
    MEDGEMMA_ID,
    token=HF_TOKEN,
    dtype=DTYPE,
    device_map="auto",
).eval()
print("MedGemma chargé")

# ─────────────────────────────────────────────────────────────────────────────
# Bloc 6 — BioMedCLIP avec filtre par région
# ─────────────────────────────────────────────────────────────────────────────
DESCRIPTIONS_REGIONS = {
    "thorax": [
        "normal chest X-ray with clear lungs",
        "pneumonia with lung consolidation or infiltrates",
        "pleural effusion with fluid collection in chest",
        "cardiomegaly with enlarged cardiac silhouette",
        "pneumothorax with collapsed lung",
        "pulmonary edema with bilateral opacities",
        "atelectasis with lung collapse",
        "lung mass or pulmonary nodule",
        "tuberculosis with upper lobe infiltrates",
        "emphysema with hyperinflated lungs",
        "rib fracture visible on chest X-ray",
        "mediastinal widening",
        "hilar lymphadenopathy",
        "bronchitis with airway thickening",
        "normal variant or incidental finding on chest X-ray",
    ],
    "cerveau": [
        "normal brain MRI with no abnormality",
        "cerebral hemorrhage with hyperdensity",
        "ischemic stroke with brain infarction",
        "brain tumor or cerebral mass",
        "hydrocephalus with enlarged ventricles",
        "cerebral edema with midline shift",
        "white matter lesions",
        "cerebral atrophy",
        "meningioma",
        "brain metastasis",
        "subarachnoid hemorrhage",
        "subdural hematoma",
        "normal brain variant",
    ],
    "abdomen": [
        "normal abdominal examination",
        "liver mass or hepatic lesion",
        "gallstones or cholecystitis",
        "kidney stones or nephrolithiasis",
        "ascites with free abdominal fluid",
        "bowel obstruction",
        "splenomegaly with enlarged spleen",
        "pancreatic mass or pancreatitis",
        "abdominal aortic aneurysm",
        "normal abdominal variant",
    ],
    "os": [
        "normal bone X-ray",
        "bone fracture or cortical break",
        "osteoporosis with decreased bone density",
        "osteolytic bone lesion",
        "joint dislocation",
        "arthritis with joint space narrowing",
        "osteomyelitis with bone infection",
        "stress fracture",
        "bone tumor or lesion",
        "normal bone variant",
    ],
    "general": [
        "normal radiological examination",
        "pneumonia or pulmonary consolidation",
        "pleural effusion",
        "cardiomegaly",
        "pneumothorax",
        "fracture or bone break",
        "mass or tumor",
        "hemorrhage or bleeding",
        "edema or fluid accumulation",
        "consolidation or infiltrate",
        "atelectasis",
        "calcification",
        "lymphadenopathy",
        "vascular abnormality",
        "normal variant",
    ],
}


def _cle_region(partie_corps: str = "") -> str:
    pc = (partie_corps or "").lower()
    if any(k in pc for k in ["thorax", "poumon", "chest", "pulm", "radio thorac"]):
        return "thorax"
    if any(k in pc for k in ["cerveau", "crane", "crâne", "brain", "head", "neuro", "irm cerv"]):
        return "cerveau"
    if any(k in pc for k in ["abdomen", "abdomin", "foie", "rein", "hepat", "digestif"]):
        return "abdomen"
    if any(k in pc for k in ["os", "genou", "hanche", "rachis", "vert", "colonne", "fracture"]):
        return "os"
    return "general"


def _get_descriptions(partie_corps: str = ""):
    return DESCRIPTIONS_REGIONS[_cle_region(partie_corps)]


def _finding_coherent_avec_region(finding: str, partie_corps: str) -> bool:
    if not partie_corps:
        return True
    pc, f = partie_corps.lower(), finding.lower()
    if any(k in pc for k in ["thorax", "poumon", "chest", "pulm"]):
        exclus = ["brain", "cerebral", "cerebr", "cranial", "liver", "hepatic",
                  "renal", "kidney", "spleen", "pancrea", "bowel", "ascit"]
        return not any(m in f for m in exclus)
    if any(k in pc for k in ["cerveau", "crane", "crâne", "brain", "head"]):
        exclus = ["lung", "pleural", "pulmon", "thorac", "cardiac", "mediastin",
                  "rib", "bronch", "liver", "hepatic", "renal", "kidney"]
        return not any(m in f for m in exclus)
    if any(k in pc for k in ["abdomen", "abdomin", "foie", "rein"]):
        exclus = ["lung", "pleural", "brain", "cerebral", "thorac", "cardiac", "rib", "pneumo"]
        return not any(m in f for m in exclus)
    return True


_cache_textes = {}


@torch.inference_mode()
def _vecteurs_textes(descriptions):
    """Les descriptions d'une région ne changent jamais : on les encode une fois, pas à chaque image."""
    cle = tuple(descriptions)
    if cle not in _cache_textes:
        dev = next(biomedclip_model.parameters()).device
        tokens = biomedclip_tokenizer(descriptions).to(dev)
        _cache_textes[cle] = F.normalize(biomedclip_model.encode_text(tokens).float(), dim=-1)
    return _cache_textes[cle]


@torch.inference_mode()
def detecter_avec_biomedclip(image_pil, seuil=SEUIL_CLIP, partie_corps=""):
    descriptions = _get_descriptions(partie_corps)
    dev = next(biomedclip_model.parameters()).device
    image_tensor = biomedclip_preprocess(image_pil).unsqueeze(0).to(dev)

    img_f = F.normalize(biomedclip_model.encode_image(image_tensor).float(), dim=-1)
    txt_f = _vecteurs_textes(descriptions)
    probs = F.softmax((img_f @ txt_f.T).squeeze(0) * 100.0, dim=-1)

    scores, findings = {}, []
    for i, (desc, p) in enumerate(zip(descriptions, probs)):
        scores[desc] = float(p)
        # i == 0 : description « normale » — jamais comptée comme anomalie
        if scores[desc] >= seuil and i > 0 and _finding_coherent_avec_region(desc, partie_corps):
            findings.append(desc)

    findings.sort(key=lambda d: scores[d], reverse=True)
    findings = findings[:MAX_FINDINGS]
    return {
        "statut": "Anomalies détectées" if findings else "Normal",
        "findings": findings,
        "scores": {d: round(scores[d], 3) for d in findings},
        "region": partie_corps or "général",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Bloc 7 — MedGemma : rapport global unique (CLIP = contexte interne)
# ─────────────────────────────────────────────────────────────────────────────
PREFIXES = [
    r"^Absolument\s*[!,.]?\s*",
    r"^Bien sûr\s*[!,.]?\s*",
    r"^Voici\s+.{0,120}[,:\n]",
    r"^Je vais\s+.{0,120}\.\s*",
    r"^Certainly\s*[!,.]?\s*",
    r"^D'accord\s*[!,.]?\s*",
    r"^En tant que radiologue\s*.{0,120}[,:\n]",
    r"^Basé sur .{0,120}[,:\n]",
    r"^Sur la base .{0,120}[,:\n]",
]


def nettoyer(texte: str) -> str:
    t = texte.strip()
    for p in PREFIXES:
        t = re.sub(p, "", t, flags=re.IGNORECASE | re.DOTALL).lstrip()
    return t.strip()


# Structures à décrire une par une dans OBSERVATIONS : une liste à compléter obtient d'un modèle 4B
# un compte rendu bien plus complet qu'une simple consigne « sois explicite »
STRUCTURES_REGIONS = {
    "thorax": [
        "Parenchyme pulmonaire droit", "Parenchyme pulmonaire gauche",
        "Plèvre et culs-de-sac costo-diaphragmatiques", "Silhouette cardiaque (index cardio-thoracique)",
        "Médiastin et trachée", "Hiles pulmonaires", "Coupoles diaphragmatiques", "Cadre osseux et parties molles",
    ],
    "cerveau": [
        "Parenchyme cérébral (substance blanche et substance grise)", "Système ventriculaire", "Ligne médiane",
        "Sillons et espaces sous-arachnoïdiens", "Fosse postérieure (cervelet, tronc cérébral)",
        "Voûte et base du crâne",
    ],
    "abdomen": [
        "Foie", "Vésicule et voies biliaires", "Pancréas", "Rate", "Reins et voies urinaires",
        "Tube digestif", "Aorte et vaisseaux", "Épanchement péritonéal", "Cadre osseux",
    ],
    "os": [
        "Alignement osseux et articulaire", "Corticales et trame osseuse", "Interlignes articulaires",
        "Recherche de fracture ou de lésion focale", "Parties molles",
    ],
    "general": ["Structures anatomiques visibles", "Densités et contours", "Parties molles", "Cadre osseux"],
}

# Les étiquettes BioMedCLIP sont en anglais : traduites ici pour que l'anglais ne passe pas dans le compte rendu
TRADUCTIONS = {
    "pneumonia with lung consolidation or infiltrates": "pneumopathie avec condensation ou infiltrat",
    "pleural effusion with fluid collection in chest": "épanchement pleural",
    "cardiomegaly with enlarged cardiac silhouette": "cardiomégalie",
    "pneumothorax with collapsed lung": "pneumothorax",
    "pulmonary edema with bilateral opacities": "œdème pulmonaire (opacités bilatérales)",
    "atelectasis with lung collapse": "atélectasie",
    "lung mass or pulmonary nodule": "masse ou nodule pulmonaire",
    "tuberculosis with upper lobe infiltrates": "infiltrats des lobes supérieurs évocateurs de tuberculose",
    "emphysema with hyperinflated lungs": "emphysème avec distension thoracique",
    "rib fracture visible on chest X-ray": "fracture costale",
    "mediastinal widening": "élargissement médiastinal",
    "hilar lymphadenopathy": "adénopathies hilaires",
    "bronchitis with airway thickening": "épaississement des parois bronchiques",
    "normal variant or incidental finding on chest X-ray": "variante de la normale ou découverte fortuite",
    "cerebral hemorrhage with hyperdensity": "hémorragie cérébrale (hyperdensité)",
    "ischemic stroke with brain infarction": "accident vasculaire ischémique",
    "brain tumor or cerebral mass": "tumeur ou masse cérébrale",
    "hydrocephalus with enlarged ventricles": "hydrocéphalie (dilatation ventriculaire)",
    "cerebral edema with midline shift": "œdème cérébral avec déviation de la ligne médiane",
    "white matter lesions": "lésions de la substance blanche",
    "cerebral atrophy": "atrophie cérébrale",
    "meningioma": "méningiome",
    "brain metastasis": "métastase cérébrale",
    "subarachnoid hemorrhage": "hémorragie sous-arachnoïdienne",
    "subdural hematoma": "hématome sous-dural",
    "normal brain variant": "variante de la normale",
    "liver mass or hepatic lesion": "lésion ou masse hépatique",
    "gallstones or cholecystitis": "lithiase vésiculaire ou cholécystite",
    "kidney stones or nephrolithiasis": "lithiase rénale",
    "ascites with free abdominal fluid": "ascite (épanchement péritonéal)",
    "bowel obstruction": "occlusion intestinale",
    "splenomegaly with enlarged spleen": "splénomégalie",
    "pancreatic mass or pancreatitis": "masse pancréatique ou pancréatite",
    "abdominal aortic aneurysm": "anévrisme de l'aorte abdominale",
    "normal abdominal variant": "variante de la normale",
    "bone fracture or cortical break": "fracture (rupture corticale)",
    "osteoporosis with decreased bone density": "ostéoporose (déminéralisation)",
    "osteolytic bone lesion": "lésion osseuse ostéolytique",
    "joint dislocation": "luxation articulaire",
    "arthritis with joint space narrowing": "arthropathie avec pincement articulaire",
    "osteomyelitis with bone infection": "ostéomyélite",
    "stress fracture": "fracture de fatigue",
    "bone tumor or lesion": "tumeur ou lésion osseuse",
    "normal bone variant": "variante de la normale",
    "pneumonia or pulmonary consolidation": "pneumopathie ou condensation pulmonaire",
    "pleural effusion": "épanchement pleural",
    "cardiomegaly": "cardiomégalie",
    "pneumothorax": "pneumothorax",
    "fracture or bone break": "fracture",
    "mass or tumor": "masse ou tumeur",
    "hemorrhage or bleeding": "hémorragie",
    "edema or fluid accumulation": "œdème ou collection liquidienne",
    "consolidation or infiltrate": "condensation ou infiltrat",
    "atelectasis": "atélectasie",
    "calcification": "calcifications",
    "lymphadenopathy": "adénopathies",
    "vascular abnormality": "anomalie vasculaire",
    "normal variant": "variante de la normale",
}

NOMS_REGIONS = {"thorax": "thorax", "cerveau": "cerveau / crâne", "abdomen": "abdomen",
                "os": "os / articulations", "general": "examen général"}


@torch.inference_mode()
def generer_rapport_global(images_et_noms, detections, patient_label, partie_corps,
                           indication="", prompt_custom=None, modalite="", patient_info=""):
    nb = len(images_et_noms)
    cle = _cle_region(partie_corps)
    region = NOMS_REGIONS[cle] if partie_corps else "non précisée"
    modalite = modalite.strip() or "Imagerie (modalité non précisée)"

    lignes, anomalies = [], []
    for i, ((img, nom), det) in enumerate(zip(images_et_noms, detections)):
        if det["statut"] != "Normal" and det["findings"]:
            ok = [f for f in det["findings"] if _finding_coherent_avec_region(f, partie_corps)]
            if ok:
                lignes.append(f"  - Image {i+1} : {', '.join(TRADUCTIONS.get(f, f) for f in ok[:3])}")
                anomalies.append((i, img, nom, len(ok)))

    contexte_clip = (
        f"  - {len(anomalies)} image(s) suspecte(s) sur {nb}\n" + "\n".join(lignes) if lignes
        else f"  - Aucune anomalie suspectée sur les {nb} image(s) : décris néanmoins chaque structure."
    )

    image_rep = max(anomalies, key=lambda x: x[3])[1] if anomalies else images_et_noms[0][0]

    question = ""
    if prompt_custom and prompt_custom.strip():
        question = (f'\nQUESTION DU MÉDECIN DEMANDEUR : "{prompt_custom.strip()}"\n'
                    "Réponds-y explicitement dans IMPRESSION DIAGNOSTIQUE.\n")
    structures = "\n".join(f"- {s} :" for s in STRUCTURES_REGIONS[cle])

    system_txt = f"""Tu es radiologue senior. Rédige UN SEUL compte rendu radiologique global, complet et détaillé, pour ce dossier.

DONNÉES DE L'EXAMEN (fiables, à reprendre telles quelles) :
  Modalité   : {modalite} (n'en invente pas une autre)
  Région     : {region}
  Patient    : {patient_info.strip() or 'âge et sexe non renseignés'}
  Images     : {nb} image(s) analysée(s)
  Indication : {indication.strip() or 'non renseignée'}

PISTES DE L'ANALYSE AUTOMATIQUE (à confirmer ou infirmer sur l'image, ne pas recopier telles quelles) :
{contexte_clip}

RÈGLES DE RÉDACTION :
- Le lecteur est un médecin non radiologue : sois explicite, en phrases complètes, en français uniquement (aucun mot anglais).
- OBSERVATIONS : complète CHAQUE ligne de la liste par une ou deux phrases décrivant l'aspect, normal ou anormal. N'en laisse aucune vide.
- Pour toute anomalie : localisation précise (côté, lobe, segment ou territoire), taille approximative en mm ou cm,
  densité ou signal, contours, étendue et sévérité (minime, modérée, marquée).
- Cite explicitement les éléments négatifs utiles (par ex. « pas d'épanchement pleural, pas de pneumothorax »).
- ANOMALIES DÉTECTÉES : liste numérotée, une anomalie par ligne avec sa localisation ; sinon écris « Aucune anomalie significative ».
- IMPRESSION DIAGNOSTIQUE : 2 à 4 points numérotés, du plus important au moins important :
  diagnostic le plus probable, puis diagnostics différentiels, en lien avec l'indication.
- RECOMMANDATIONS : conduite concrète (examen complémentaire, avis spécialisé, contrôle) avec un délai indicatif.
- Reste dans la région {region} ; ne cite ni outil, ni modèle, ni logiciel d'IA ; pas d'introduction ni de formule de politesse.
{question}
Reproduis exactement ce plan en complétant chaque rubrique :

**TYPE D'EXAMEN** : {modalite} — {region}
**INDICATION CLINIQUE** :
**TECHNIQUE** :
**OBSERVATIONS** :
{structures}
**ANOMALIES DÉTECTÉES** :
**IMPRESSION DIAGNOSTIQUE** :
**RECOMMANDATIONS** :"""

    messages = [{"role": "user", "content": [
        {"type": "image", "image": image_rep},
        {"type": "text", "text": system_txt},
    ]}]
    inputs = medgemma_processor.apply_chat_template(
        messages, add_generation_prompt=True, tokenize=True,
        return_dict=True, return_tensors="pt",
    ).to(medgemma_model.device)
    input_len = inputs["input_ids"].shape[-1]
    t0 = time.perf_counter()
    options = dict(max_new_tokens=MAX_NOUVEAUX_TOKENS, do_sample=False, repetition_penalty=PENALITE_REPETITION)
    outputs = None
    if PROMPT_LOOKUP:
        try:
            outputs = medgemma_model.generate(**inputs, **options, prompt_lookup_num_tokens=PROMPT_LOOKUP)
        except Exception as e:  # version de transformers ou cache du modèle incompatible : génération classique
            print(f"Prompt lookup indisponible ({type(e).__name__}: {str(e)[:160]}), génération classique")
    if outputs is None:
        outputs = medgemma_model.generate(**inputs, **options)
    nb = outputs.shape[-1] - input_len
    duree = time.perf_counter() - t0
    print(f"MedGemma : {input_len} jetons lus, {nb} rédigés en {duree:.1f} s ({nb / duree:.1f} jetons/s)")
    rapport = medgemma_processor.decode(outputs[0][input_len:], skip_special_tokens=True)
    del inputs, outputs
    torch.cuda.empty_cache()
    return nettoyer(rapport)


# ─────────────────────────────────────────────────────────────────────────────
# Entrées : images, ZIP, NIfTI
# ─────────────────────────────────────────────────────────────────────────────
EXT_IMAGES = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}
EXT_NIFTI = (".nii", ".nii.gz")
EXT_DICOM = (".dcm", ".dicom")


def redimensionner(image, taille=512):
    img = image.convert("RGB").copy()
    img.thumbnail((taille, taille), PILImage.LANCZOS)
    return img


def nifti_vers_coupes(data_bytes, nom, nb_coupes_max=10):
    import nibabel as nib
    suffix = ".nii.gz" if nom.endswith(".gz") else ".nii"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
        tmp.write(data_bytes)
        tmp.flush()
        data = nib.load(tmp.name).get_fdata()
    vmin, vmax = data.min(), data.max()
    if vmax - vmin > 0:
        data = (data - vmin) / (vmax - vmin) * 255
    data = data.astype(np.uint8)
    coupes = []
    if data.ndim == 3:
        nz = data.shape[2]
        d, f = int(nz * 0.2), int(nz * 0.8)
        pas = max(1, (f - d) // nb_coupes_max)
        for idx in list(range(d, f, pas))[:nb_coupes_max]:
            coupes.append((redimensionner(PILImage.fromarray(data[:, :, idx])), f"{nom}_coupe_{idx:03d}"))
    return coupes


def _indices_centraux(n, nb_max):
    """Comme pour le NIfTI : au-delà de nb_max, on échantillonne entre 20 % et 80 % du volume."""
    if n <= nb_max:
        return list(range(n))
    d, f = int(n * 0.2), int(n * 0.8)
    return list(range(d, f, max(1, (f - d) // nb_max)))[:nb_max]


def est_dicom(data_bytes):
    # Préambule DICOM standard : 128 octets puis « DICM ». Les PACS exportent souvent des fichiers sans extension.
    return len(data_bytes) > 132 and data_bytes[128:132] == b"DICM"


def _lire_dicom(data_bytes, pixels=True):
    import pydicom
    return pydicom.dcmread(io.BytesIO(data_bytes), force=True, stop_before_pixels=not pixels)


def _vers_uint8(arr):
    arr = arr.astype(np.float32)
    vmin, vmax = float(arr.min()), float(arr.max())
    arr = (arr - vmin) / (vmax - vmin) * 255 if vmax > vmin else np.zeros_like(arr)
    return arr.astype(np.uint8)


def _dicom_vers_pil(ds, arr):
    """Une image DICOM (2D ou couleur) → PIL, avec le fenêtrage choisi par l'appareil."""
    from pydicom.pixels import apply_modality_lut, apply_voi_lut
    if arr.ndim == 3 and arr.shape[-1] == 3:  # couleur (échographie, captures)
        return redimensionner(PILImage.fromarray(_vers_uint8(arr)))
    arr = apply_modality_lut(arr, ds)  # valeurs brutes → unités réelles (Hounsfield en scanner)
    if "WindowCenter" in ds or "VOILUTSequence" in ds:
        arr = apply_voi_lut(arr, ds)
    img = _vers_uint8(arr)
    if str(ds.get("PhotometricInterpretation", "")).upper() == "MONOCHROME1":
        img = 255 - img  # MONOCHROME1 : le blanc vaut 0, on inverse pour un affichage radiologique normal
    return redimensionner(PILImage.fromarray(img))


def dicom_vers_images(data_bytes, nom, nb_coupes_max=10):
    ds = _lire_dicom(data_bytes)
    arr = ds.pixel_array
    nb_frames = int(ds.get("NumberOfFrames", 1) or 1)
    if nb_frames > 1:  # multi-frame : ciné, tomosynthèse, scanner enregistré en un seul fichier
        return [(_dicom_vers_pil(ds, arr[i]), f"{nom}_image_{i:03d}") for i in _indices_centraux(nb_frames, nb_coupes_max)]
    return [(_dicom_vers_pil(ds, arr), nom)]


def serie_dicom_vers_coupes(entrees, nb_coupes_max=10):
    """DICOM trouvés dans un ZIP : regroupés par série, triés par numéro d'instance.
    Une longue série (scanner, IRM) est échantillonnée comme un NIfTI ; des clichés isolés sont tous gardés."""
    series = {}
    for nom, data in entrees:
        try:
            ds = _lire_dicom(data, pixels=False)
            numero = int(ds.get("InstanceNumber", 0) or 0)
        except Exception:
            continue
        series.setdefault(str(ds.get("SeriesInstanceUID", nom)), []).append((numero, nom, data))
    out = []
    for coupes in series.values():
        coupes.sort(key=lambda c: c[0])
        for i in _indices_centraux(len(coupes), nb_coupes_max):
            _, nom, data = coupes[i]
            try:
                out.extend(dicom_vers_images(data, nom, nb_coupes_max=3))
            except Exception:
                continue  # compression non prise en charge, pixels absents (rapport structuré)…
    return out


def charger_fichier(nom, data_bytes):
    """Retourne une liste [(PIL, nom)] à partir d'une image, d'un NIfTI, d'un DICOM ou d'un ZIP."""
    nom_l = nom.lower()
    if nom_l.endswith(".zip"):
        out, dicoms = [], []
        with zipfile.ZipFile(io.BytesIO(data_bytes)) as z:
            for info in z.infolist():
                n = info.filename
                if info.is_dir() or n.startswith("__MACOSX") or "/." in n:
                    continue
                if info.file_size > MAX_FILE_MB * 1024 * 1024:
                    continue
                base, data = os.path.basename(n), z.read(info)
                if base.lower().endswith(EXT_DICOM) or est_dicom(data):
                    dicoms.append((base, data))  # traités ensemble : il faut voir toute la série pour la trier
                    continue
                out.extend(charger_fichier(base, data))
                if len(out) >= MAX_IMAGES:
                    break
        if dicoms:
            out.extend(serie_dicom_vers_coupes(dicoms))
        return out
    if nom_l.endswith(EXT_NIFTI):
        return nifti_vers_coupes(data_bytes, nom)
    if nom_l.endswith(EXT_DICOM) or est_dicom(data_bytes):
        try:
            return dicom_vers_images(data_bytes, nom)
        except Exception:
            return []
    if os.path.splitext(nom_l)[1] in EXT_IMAGES:
        try:
            return [(redimensionner(PILImage.open(io.BytesIO(data_bytes))), nom)]
        except Exception:
            return []
    return []


# ─────────────────────────────────────────────────────────────────────────────
# API
# ─────────────────────────────────────────────────────────────────────────────
app = FastAPI(title="MedVision IA", version="2.0", docs_url=None, redoc_url=None)


def verifier_cle(x_api_key: Optional[str] = Header(default=None)):
    if not x_api_key or not secrets.compare_digest(x_api_key, API_KEY):
        raise HTTPException(status_code=401, detail="Clé API invalide")


@app.get("/health")
def health():
    vram = (torch.cuda.memory_reserved(0) / 1e9) if torch.cuda.is_available() else 0
    return {"status": "ok", "device": DEVICE, "vram_gb": round(vram, 1),
            "models": ["BiomedCLIP", "medgemma-4b-it"]}


def analyser_fichiers(fichiers, region="", patient_label="", indication="", question="",
                      modalite="", patient_info=""):
    """Cœur de l'analyse, sans FastAPI : partagé par la route /analyze (Colab, Docker)
    et par le moteur GPU de modal_app.py. `fichiers` : liste de (nom, octets)."""
    images = []
    for nom, data in fichiers:
        if len(data) > MAX_FILE_MB * 1024 * 1024:
            raise HTTPException(413, f"Fichier trop volumineux : {nom}")
        images.extend(charger_fichier(nom, data))
        if len(images) >= MAX_IMAGES:
            images = images[:MAX_IMAGES]
            break
    if not images:
        raise HTTPException(400, "Aucune image exploitable (PNG, JPG, NIfTI ou ZIP).")

    t0 = time.perf_counter()
    detections = []
    for img, _ in images:
        try:
            detections.append(detecter_avec_biomedclip(img, partie_corps=region))
        except Exception as e:  # une image illisible ne bloque pas le dossier
            detections.append({"statut": "Erreur", "findings": [], "scores": {},
                               "region": region, "erreur": str(e)[:120]})
        torch.cuda.empty_cache()
    print(f"BioMedCLIP : {len(images)} image(s) en {time.perf_counter() - t0:.1f} s")

    try:
        rapport = generer_rapport_global(images, detections, patient_label, region,
                                         indication=indication, prompt_custom=question,
                                         modalite=modalite, patient_info=patient_info)
    except torch.cuda.OutOfMemoryError:
        gc.collect()
        torch.cuda.empty_cache()
        raise HTTPException(503, "Mémoire GPU insuffisante — réessayez avec moins d'images.")

    return {
        "rapport": rapport,
        "nb_images": len(images),
        # Détections CLIP : contexte interne, stockées pour traçabilité,
        # jamais affichées dans le rapport final.
        "detections": [{"image": n, **d} for (_, n), d in zip(images, detections)],
        "modele": "MedGemma 4B-IT + BioMedCLIP",
        "genere_le": datetime.now().isoformat(),
    }


@app.post("/analyze", dependencies=[Depends(verifier_cle)])
async def analyze(
    files: List[UploadFile] = File(...),
    region: str = Form(""),
    patient_label: str = Form(""),
    indication: str = Form(""),
    question: str = Form(""),
    modalite: str = Form(""),
    patient_info: str = Form(""),
):
    fichiers = [(f.filename or "image", await f.read()) for f in files]
    return analyser_fichiers(fichiers, region, patient_label, indication, question, modalite, patient_info)
