"""
MedVision IA sur Modal — remplace Colab par une adresse fixe, sans rien à lancer.

Deux étages :
  - porte d'entrée (CPU, quasi gratuite) : répond à /health, vérifie la clé API,
    reçoit les images. Le frontend interroge /health toutes les 60 s : si cette
    route tournait sur le GPU, il ne s'éteindrait jamais.
  - moteur (GPU) : charge BioMedCLIP + MedGemma via app.py, ne s'allume que pour
    une analyse et s'éteint après 5 minutes sans travail.

Mise en place (une seule fois) :
    pip install modal
    modal setup
    modal secret create medvision-secrets HF_TOKEN=hf_xxx MEDVISION_API_KEY=xxxx
    modal run modal_app.py::telecharger_modeles     # copie les modèles dans le volume (~10 min)
    modal deploy modal_app.py                        # affiche l'URL fixe à mettre dans AI_SERVICE_URL
"""

import os
import secrets
from pathlib import Path
from typing import List, Optional

import modal

ICI = Path(__file__).parent
BIOMEDCLIP_REPO = "microsoft/BiomedCLIP-PubMedBERT_256-vit_base_patch16_224"
MEDGEMMA_ID = "google/medgemma-4b-it"
# None : CPU seul (8 cœurs, 32 Go) — fonctionne avec le crédit gratuit, sans carte bancaire, mais lent.
#        Mesuré le 27/10/2026 : ~1 jeton/s en float32 (les CPU Modal n'ont pas de bfloat16 natif),
#        soit 3 à 5 min par rapport. Passer à 16 cœurs n'accélère rien : chaque mot généré relit les
#        16 Go du modèle, c'est la bande passante mémoire qui limite, pas le calcul.
# "L4" ou "T4" : GPU, ~20-40 s par analyse — Modal exige alors un moyen de paiement.
GPU = None
COEURS = 8
RESSOURCES = {"gpu": GPU} if GPU else {"cpu": float(COEURS), "memory": 32768}
MAX_FILE_MB = 50

app = modal.App("medvision-ia")
secret = modal.Secret.from_name("medvision-secrets")
# Cache Hugging Face persistant : les ~9 Go de modèles ne sont téléchargés qu'une fois.
cache = modal.Volume.from_name("medvision-hf-cache", create_if_missing=True)

image_gpu = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install_from_requirements(str(ICI / "requirements.txt"))
    .env({"HF_HOME": "/cache", "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
          "TORCH_THREADS": str(COEURS)})
    .add_local_file(str(ICI / "app.py"), "/root/app.py")
)
image_web = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]", "python-multipart")


@app.function(image=image_gpu, secrets=[secret], volumes={"/cache": cache}, timeout=3600)
def telecharger_modeles():
    """À lancer une fois : remplit le volume, pour que le premier réveil du GPU soit rapide."""
    from huggingface_hub import snapshot_download

    jeton = os.environ["HF_TOKEN"].strip()
    for repo in (BIOMEDCLIP_REPO, MEDGEMMA_ID):
        print(f"Téléchargement de {repo}...")
        snapshot_download(repo, token=jeton)
    cache.commit()
    print("✅ Modèles enregistrés dans le volume medvision-hf-cache")


@app.cls(
    image=image_gpu,
    **RESSOURCES,
    secrets=[secret],
    volumes={"/cache": cache},
    scaledown_window=300,  # s'éteint après 5 min sans analyse
    max_containers=1,  # une seule machine à la fois : plafonne la facture
    timeout=1800,
)
class MoteurIA:
    @modal.enter()
    def charger(self):
        # Même nettoyage que dans Colab : une espace collée dans le secret ne doit rien casser.
        os.environ["MEDVISION_API_KEY"] = os.environ["MEDVISION_API_KEY"].strip()
        os.environ["HF_TOKEN"] = os.environ["HF_TOKEN"].strip()
        import app as ia  # charge les deux modèles (app.py, inchangé)

        self.ia = ia

    @modal.method()
    def ping(self) -> str:
        """Ne fait rien : l'appeler suffit à démarrer la machine et charger les modèles à l'avance."""
        return "prêt"

    @modal.method()
    def analyser(self, fichiers, region, patient_label, indication, question, modalite="", patient_info="") -> dict:
        from fastapi import HTTPException

        try:
            return self.ia.analyser_fichiers(fichiers, region, patient_label, indication, question,
                                             modalite, patient_info)
        except HTTPException as e:
            # renvoyé sous forme de dict : plus sûr que de faire traverser l'exception jusqu'à la porte d'entrée
            return {"_erreur": e.status_code, "detail": e.detail}


    @modal.method()
    def comparer(self, fichiers, nb_jetons=300) -> dict:
        """Même analyse avec et sans prompt lookup, dans la même machine chaude (voir `comparer` plus bas)."""
        import time

        ia = self.ia
        ia.MAX_NOUVEAUX_TOKENS = nb_jetons
        res = {}
        for n in (ia.PROMPT_LOOKUP or 10, 0):  # accéléré d'abord : le 1er passage n'est pas avantagé
            ia.PROMPT_LOOKUP = n
            t0 = time.perf_counter()
            r = ia.analyser_fichiers(fichiers, "thorax", "ESSAI", "Toux fébrile", "", "Radiographie", "46 ans, masculin")
            res[n] = {"secondes": round(time.perf_counter() - t0, 1), "rapport": r["rapport"]}
        return res


def _image_essai() -> bytes:
    import io

    from PIL import Image, ImageDraw

    img = Image.new("L", (512, 512), 20)
    d = ImageDraw.Draw(img)
    d.ellipse((70, 60, 240, 460), fill=90)
    d.ellipse((272, 60, 442, 460), fill=90)
    d.rectangle((246, 40, 266, 480), fill=200)
    tampon = io.BytesIO()
    img.save(tampon, format="PNG")
    return tampon.getvalue()


@app.local_entrypoint()
def comparer():
    """Gain du prompt lookup : `modal run modal_app.py::comparer` (deux rapports de 300 jetons, ~10 min de CPU)."""
    res = MoteurIA().comparer.remote([("essai.png", _image_essai())])
    (acc, avec), (_, sans) = list(res.items())
    print(f"Avec prompt lookup ({acc}) : {avec['secondes']} s · sans : {sans['secondes']} s "
          f"· gain x{sans['secondes'] / avec['secondes']:.2f}")
    print("Textes identiques :", avec["rapport"] == sans["rapport"])
    print(avec["rapport"][:900])


@app.local_entrypoint()
def banc():
    """Mesure la vitesse sur une image synthétique : `modal run modal_app.py::banc`.
    Les temps détaillés (jetons/s) s'affichent dans les journaux du moteur."""
    import time

    t0 = time.perf_counter()
    res = MoteurIA().analyser.remote([("essai.png", _image_essai())], "thorax", "ESSAI", "", "")
    print(f"Analyse complète (démarrage compris) : {time.perf_counter() - t0:.0f} s")
    print((res.get("rapport") or str(res))[:600])


@app.function(image=image_web, secrets=[secret], timeout=1800)
@modal.concurrent(max_inputs=20)
@modal.asgi_app()
def web():
    from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile

    cle = os.environ["MEDVISION_API_KEY"].strip()
    api = FastAPI(title="MedVision IA", docs_url=None, redoc_url=None)

    def verifier_cle(x_api_key: Optional[str] = Header(default=None)):
        if not x_api_key or not secrets.compare_digest(x_api_key, cle):
            raise HTTPException(status_code=401, detail="Clé API invalide")

    @api.get("/health")
    def health():
        # ne réveille pas le GPU : le service est « en ligne » tant que Modal l'est
        return {"status": "ok", "device": f"modal-{(GPU or 'cpu').lower()} (à la demande)",
                "models": ["BiomedCLIP", "medgemma-4b-it"]}

    @api.post("/warmup", dependencies=[Depends(verifier_cle)])
    async def warmup():
        # Appelé quand un médecin ouvre le formulaire d'examen : le moteur démarre pendant
        # qu'il remplit la fiche, au lieu d'après l'envoi. Sans attente de réponse.
        await MoteurIA().ping.spawn.aio()
        return {"ok": True}

    @api.post("/analyze", dependencies=[Depends(verifier_cle)])
    async def analyze(
        request: Request,
        files: List[UploadFile] = File(...),
        region: str = Form(""),
        patient_label: str = Form(""),
        indication: str = Form(""),
        question: str = Form(""),
        modalite: str = Form(""),
        patient_info: str = Form(""),
    ):
        fichiers = []
        for f in files:
            data = await f.read()
            if len(data) > MAX_FILE_MB * 1024 * 1024:
                raise HTTPException(413, f"Fichier trop volumineux : {f.filename}")
            fichiers.append((f.filename or "image", data))
        # spawn + attente par tranches : si le backend abandonne (analyse arrêtée par le radiologue),
        # le calcul est annulé au lieu d'occuper l'unique machine jusqu'à la fin du compte rendu
        appel = await MoteurIA().analyser.spawn.aio(
            fichiers, region, patient_label, indication, question, modalite, patient_info)
        while True:
            try:
                res = await appel.get.aio(timeout=5)
                break
            except (TimeoutError, modal.exception.TimeoutError):
                if await request.is_disconnected():
                    await appel.cancel.aio()
                    print("Client déconnecté : analyse annulée")
                    raise HTTPException(499, "Analyse annulée par le client")
        if "_erreur" in res:
            raise HTTPException(res["_erreur"], res["detail"])
        return res

    return api
