# Hakili OCR

Hakili OCR transforme des photos, scans ou PDF de copies de mathématiques
manuscrites en transcription structurée, éditable, en Markdown/LaTeX. Un
élève ou un enseignant dépose une image ou un PDF, l'app envoie le document
à Claude (API Anthropic) et affiche le résultat côte à côte avec l'image
source : blocs de contenu surlignés par zone (bounding box colorée selon la
confiance), édition du texte en place, repositionnement des boîtes,
export Excel/PDF.

Pour l'architecture détaillée (backend et frontend), les décisions de
conception, et le suivi des chantiers en cours, voir [`CLAUDE.md`](CLAUDE.md)
— ce README est un point d'entrée pratique, pas un duplicata de cette
référence.

## Structure du dépôt

```
ocr-app/
├── ocr-math-api/     # Backend Python/FastAPI — appelle Claude, sert l'API REST
└── hakili-ocr/       # Frontend React 19 + TypeScript + Vite — interface utilisateur
```

Les deux projets communiquent uniquement en HTTP (le frontend appelle le
backend). Ils doivent tourner simultanément pour que l'app fonctionne de
bout en bout.

## Démarrage rapide (Docker, recommandé)

Depuis la racine du dépôt :

```bash
cp .env.example .env    # puis renseigner ANTHROPIC_API_KEY, APP_API_KEY, etc.
docker compose up -d --build
```

- Frontend : `http://localhost:8080`
- Backend : `http://localhost:8000` (docs Swagger : `http://localhost:8000/docs`)

Après une modification de code :

```bash
docker compose up -d --build backend    # ou frontend
```

## Démarrage en développement (sans Docker)

**Backend** (`ocr-math-api/`) :

```bash
python -m venv .venv
.venv\Scripts\activate            # Windows
pip install -r requirements.txt
cp .env.example .env              # puis renseigner ANTHROPIC_API_KEY
uvicorn app.main:app --reload     # http://127.0.0.1:8000
```

**Frontend** (`hakili-ocr/`) :

```bash
npm install
npm run dev        # http://localhost:5173
```

Voir le `## Commands` de `CLAUDE.md` pour le détail des scripts disponibles
(build, lint, tests manuels) et les prérequis (PyMuPDF, WeasyPrint, etc.).

## Configuration

Les variables d'environnement sont documentées dans `.env.example` (racine,
lu par `docker-compose.yml`) et dans les `.env.example` propres à chaque
sous-projet (usage en développement local, hors Docker). Ne jamais committer
un fichier `.env` réel — déjà exclu via `.gitignore`.

Points clés :
- `ANTHROPIC_API_KEY` — clé API Anthropic (console.anthropic.com), distincte d'un abonnement Claude Pro/Max.
- `APP_API_KEY` — secret partagé entre le frontend et le backend (header `X-API-Key`), requis sur les endpoints `/transcribe*` et `/corrections`.
- `ALLOWED_ORIGINS` — origines autorisées par le CORS du backend.

## Fonctionnalités principales

- Transcription OCR d'une image ou d'un PDF (traitement asynchrone par job, avec suivi de progression page par page).
- Visualisation côte à côte : image source annotée + transcription Markdown/LaTeX.
- Édition en place du texte (bloc ou cellule de tableau) et repositionnement des bounding boxes.
- Export du résultat en Excel (`.xlsx`, généré côté client) et en PDF (généré côté serveur via WeasyPrint).
- Capture optionnelle des corrections utilisateur (image croppée + texte original/corrigé) pour amélioration future du prompt/modèle.

## Documentation

Toute la documentation d'architecture, les conventions de code, et le suivi
des chantiers (production readiness, sécurité, limitations connues) vivent
dans [`CLAUDE.md`](CLAUDE.md) — à consulter avant toute modification
substantielle du backend ou du frontend.
