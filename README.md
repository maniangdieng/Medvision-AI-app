# MedVision — Aide au compte rendu radiologique

Application web d'aide au compte rendu radiologique. Les médecins envoient les images, l'IA (BioMedCLIP + MedGemma 4B) rédige un compte rendu au format RSNA, et un radiologue le relit, le corrige puis le valide avant qu'il devienne visible.

## Architecture

```
 Navigateur (PC, tablette, téléphone)
        │  https
        ▼
 ┌──────────────────┐   /api   ┌──────────────────┐        ┌──────────────┐
 │ frontend Next.js │ ───────► │ backend NestJS   │ ─────► │ PostgreSQL   │
 │  (port 3000)     │          │  (port 4000)     │        │              │
 └──────────────────┘          └────────┬─────────┘        └──────────────┘
                                        │ HTTPS + clé API
                                        ▼
                               ┌──────────────────────────┐
                               │ ai-service (FastAPI)     │
                               │ BioMedCLIP + MedGemma 4B │
                               │ dans Colab (GPU T4)      │
                               └──────────────────────────┘
```

| Dossier | Rôle |
|---|---|
| `ai-service/` | API FastAPI portée depuis le notebook, et le notebook Colab qui la lance (`MedVision_Serveur_IA_Colab.ipynb`) |
| `backend/` | NestJS + TypeORM : comptes, authentification, patients, examens, rapports, PDF, journal d'audit |
| `frontend/` | Next.js 14 : l'interface utilisée par le personnel |

Le service IA ne stocke rien : il reçoit des images, renvoie un texte et oublie tout. Seul le **numéro de dossier** lui est transmis, jamais le nom du patient.

## Rôles

| Rôle | Peut faire |
|---|---|
| **Médecin** | créer un dossier patient, envoyer des images, lire les comptes rendus **validés** |
| **Radiologue** | tout ce que fait le médecin, plus relire, corriger, régénérer et **valider** les comptes rendus |
| **Administrateur** | créer, désactiver et réinitialiser les comptes, consulter le journal d'activité. **N'a pas accès aux dossiers médicaux.** |

Un compte rendu validé ne peut plus être modifié. Le texte brut de l'IA reste conservé à côté de la version corrigée, pour la traçabilité.

## Sécurité mise en place

- Mots de passe hachés avec bcrypt (coût 12). Politique : 10 caractères, majuscule, minuscule, chiffre.
- Mot de passe provisoire à la création du compte, avec changement **obligatoire** à la première connexion.
- Verrouillage du compte pendant 15 minutes après 5 échecs, et limitation du nombre de tentatives par minute.
- Jetons dans des cookies `httpOnly` + `SameSite=Strict` : ils sont inaccessibles au JavaScript (protection XSS) et ne partent pas vers d'autres sites (protection CSRF).
- Jeton d'accès de 15 minutes et jeton de rafraîchissement de 7 jours, haché en base et renouvelé à chaque usage. La réutilisation d'un ancien jeton ferme toutes les sessions du compte.
- Toutes les routes sont protégées par défaut, avec contrôle du rôle sur chaque route. Un compte désactivé perd l'accès immédiatement.
- Validation stricte des données entrantes (les champs inconnus sont rejetés) et en-têtes de sécurité (helmet).
- Fichiers : extensions limitées (PNG, JPG, NIfTI, ZIP), 50 Mo et 20 fichiers au maximum, stockés sous un nom aléatoire hors du site, et servis uniquement aux utilisateurs connectés.
- Journal d'audit : connexions, échecs, consultations de dossiers, créations, validations, téléchargements de PDF.
- Service IA protégé par une clé API (comparaison à temps constant). Il refuse de démarrer sans clé.

## Démarrage

### 1. Le serveur IA (Colab, gratuit)

1. Ouvrir `ai-service/MedVision_Serveur_IA_Colab.ipynb` dans Colab.
2. **Exécution > Modifier le type d'exécution > GPU T4**.
3. Dans les **Secrets** Colab (icône clé), créer `HF_TOKEN` (votre jeton Hugging Face, avec les conditions de MedGemma acceptées) et `MEDVISION_API_KEY` (une longue phrase secrète).
4. Exécuter les cellules 1 à 4. La cellule 4 affiche `AI_SERVICE_URL = https://….trycloudflare.com`.

> L'URL change à chaque nouvelle session Colab. Il faut alors la recopier dans `.env` et redémarrer le backend. Tant que Colab est éteint, l'application reste utilisable (dossiers, lecture des rapports) : les nouvelles analyses passent en « Échec », et on les relance d'un clic une fois Colab revenu.

### 1 bis. Le serveur IA sur Modal (adresse fixe, rien à relancer)

Alternative à Colab : le GPU s'allume tout seul à la première analyse et s'éteint après 5 minutes sans travail. Modal offre un crédit gratuit mensuel.

```bash
cd ai-service
pip install modal
modal setup                                   # connexion au compte Modal (ouvre le navigateur)
modal secret create medvision-secrets HF_TOKEN=hf_xxx MEDVISION_API_KEY=<même valeur que AI_API_KEY>
modal run modal_app.py::telecharger_modeles   # une seule fois : copie les modèles (~10 min)
modal deploy modal_app.py                     # affiche l'URL https://…modal.run
```

Mettre cette URL dans `AI_SERVICE_URL` (une seule fois), puis `docker compose up -d backend`.

Par défaut, `modal_app.py` tourne sur **CPU** (`GPU = None`) : Modal refuse le GPU tant qu'aucun moyen de paiement n'est enregistré, mais le CPU fonctionne avec le crédit gratuit. Une analyse « à froid » prend environ 3 minutes (mesuré). Avec une carte enregistrée, mettre `GPU = "L4"` puis relancer `modal deploy`. Sous Windows, préfixer les commandes `modal` par `PYTHONIOENCODING=utf-8` (sinon erreur `charmap`).

### 2. L'application, avec Docker (recommandé)

```bash
cp .env.example .env            # puis remplir DB_PASSWORD, JWT_SECRET, AI_SERVICE_URL, AI_API_KEY
docker compose up -d --build
docker compose exec backend npm run seed     # crée le premier administrateur
```

Ouvrir http://localhost:3000 et se connecter avec `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Le système demande alors de choisir un nouveau mot de passe. Créer ensuite les comptes des médecins et radiologues dans **Comptes**.

### 2 bis. Sans Docker (développement)

Prérequis : Node 20 et PostgreSQL.

```bash
# Backend
cd backend
cp .env.example .env            # renseigner DATABASE_URL, JWT_SECRET, AI_SERVICE_URL, AI_API_KEY
npm install
npm run build && npm run seed
npm run start:dev               # http://localhost:4000/api

# Frontend (autre terminal)
cd frontend
npm install
npm run dev                     # http://localhost:3000
```

### Accès depuis les autres postes de l'hôpital

Sur le réseau local, les autres postes ouvrent `http://<adresse-IP-du-PC>:3000`. Pour un accès depuis Internet, il faut passer en HTTPS : par exemple un tunnel Cloudflare nommé, ou un hébergement gratuit (Vercel pour le frontend, Render pour le backend, Neon pour PostgreSQL). Mettre alors `COOKIE_SECURE=true`, `DATABASE_SSL=true` pour Neon et `DB_SYNC=false` une fois les tables créées.

### Passer plus tard à un vrai serveur GPU

Le dossier `ai-service/` contient un `Dockerfile`. Sur une machine équipée d'une carte NVIDIA d'au moins 12 Go de mémoire, construire l'image, la lancer avec `MEDVISION_API_KEY` et `HF_TOKEN`, puis mettre son adresse dans `AI_SERVICE_URL`. Rien d'autre ne change.

## Changements par rapport au notebook d'origine

- **Correction du chargement de BioMedCLIP.** Le notebook créait un modèle `ViT-B-16` générique puis chargeait les poids avec `strict=False`. Résultat : 301 poids manquants (le journal de la cellule 4 l'indique), donc un encodeur de texte PubMedBERT jamais chargé, et des scores de détection en partie aléatoires. Le service utilise maintenant le chargement officiel `hf-hub:microsoft/BiomedCLIP-…`. **Les seuils (0,25) et les résultats d'évaluation obtenus avec l'ancien notebook doivent donc être revérifiés.**
- L'interface Gradio est remplacée par l'application web. Les fonctions de détection, le filtre par région, le prompt RSNA, le nettoyage des préambules et la lecture NIfTI/ZIP sont repris tels quels.
- Les détections BioMedCLIP restent un contexte interne pour MedGemma : elles sont stockées pour la traçabilité, mais jamais affichées dans le compte rendu.

## Limites connues

- Colab gratuit coupe la session au bout de quelques heures, et plus tôt en cas d'inactivité. Il convient pour un prototype ou une démonstration, pas pour un service hospitalier continu.
- Le format DICOM n'est pas encore pris en charge (à convertir en PNG au préalable).
- `DB_SYNC=true` crée les tables automatiquement. Pour une mise en production durable, passer à des migrations TypeORM.
- Outil d'aide à la décision, non certifié comme dispositif médical : la validation par un radiologue est obligatoire.
