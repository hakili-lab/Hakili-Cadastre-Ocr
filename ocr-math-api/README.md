# OCR Math API

API web professionnelle basée sur **FastAPI**, permettant de transcrire des images de copies de mathématiques manuscrites en **LaTeX structuré**, en s'appuyant sur l'API **Claude (Anthropic)**.

L'API analyse une image envoyée par upload, ignore automatiquement les ratures et gribouillages, et retourne un JSON structuré contenant :
- les blocs de contenu identifiés (exercices, questions, équations)
- leur transcription LaTeX
- leur position dans l'image (bounding box normalisée)
- un score de confiance par bloc
- un message d'alerte global si certaines zones sont douteuses

## 🗂️ Structure du projet

```
ocr-math-api/
├── app/
│   ├── main.py                  # Point d'entrée FastAPI
│   ├── config.py                # Configuration (variables d'environnement)
│   ├── routers/
│   │   └── transcription.py     # Endpoint POST /transcribe
│   ├── services/
│   │   └── claude_service.py    # Logique d'appel à l'API Claude
│   ├── models/
│   │   └── schemas.py           # Schémas Pydantic (validation stricte)
│   └── utils/
│       └── image_utils.py       # Validation et encodage des images
├── tests/
│   └── test_transcribe.py       # Script de test de l'endpoint
├── requirements.txt
├── .env.example
├── .gitignore
└── README.md
```

## ✅ Prérequis

- Python 3.10 ou supérieur
- Une clé API Anthropic valide ([console.anthropic.com](https://console.anthropic.com))

## 🚀 Installation

1. **Cloner le dépôt**

```bash
git clone https://github.com/TON_USERNAME/ocr-math-api.git
cd ocr-math-api
```

2. **Créer et activer un environnement virtuel**

```bash
python -m venv venv
source venv/bin/activate      # Linux / Mac
venv\Scripts\activate         # Windows
```

3. **Installer les dépendances**

```bash
pip install -r requirements.txt
```

Pour lancer le script de test manuel (`tests/test_transcribe.py`), installer
plutôt `requirements-dev.txt` (inclut `requirements.txt` + `requests`,
utilisé uniquement par ce script) :

```bash
pip install -r requirements-dev.txt
```

## ⚙️ Configuration

1. Copier le fichier d'exemple :

```bash
cp .env.example .env
```

2. Éditer `.env` et renseigner ta clé API :

```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxx
ANTHROPIC_MODEL=claude-sonnet-5
MAX_IMAGE_SIZE_MB=5
MAX_TOKENS=8192
```

⚠️ **Ne commit jamais ton fichier `.env`** — il est déjà exclu via `.gitignore`.

## ▶️ Lancer le serveur

```bash
uvicorn app.main:app --reload
```

Le serveur est accessible sur `http://127.0.0.1:8000`.

Documentation interactive (Swagger) : `http://127.0.0.1:8000/docs`

## 🧪 Tester l'API

**Avec le script Python fourni :**

```bash
python tests/test_transcribe.py chemin/vers/image.png
```

**Avec curl :**

```bash
curl -X POST "http://127.0.0.1:8000/transcribe" \
  -F "file=@chemin/vers/image.png;type=image/png"
```

**Exemple de réponse :**

```json
{
  "success": true,
  "result": {
    "blocks": [
      {
        "id": 1,
        "label": "Exercice 1 - Question a",
        "latex": "\\int_{0}^{1} x^2 \\, dx = \\frac{1}{3}",
        "bbox": { "x_min": 0.05, "y_min": 0.10, "x_max": 0.95, "y_max": 0.25 },
        "confidence": 95
      }
    ],
    "final_warning": null
  }
}
```

## 🛡️ Gestion des erreurs

| Code | Cas |
|------|-----|
| 400  | Fichier invalide (format non supporté, taille dépassée) |
| 422  | Réponse Claude invalide ou non conforme au schéma attendu |
| 500  | Erreur de configuration (clé API manquante) ou erreur inattendue |
| 502  | Erreur lors de l'appel à l'API Anthropic |

## 📦 Dépendances principales

- `fastapi` — framework web
- `uvicorn[standard]` — serveur ASGI
- `anthropic` — client officiel de l'API Claude
- `pydantic` — validation stricte des données
- `python-multipart` — gestion des uploads de fichiers
- `python-dotenv` — chargement des variables d'environnement

## 🔜 Prochaines étapes

Le frontend (React, `hakili-ocr/`) existe déjà et consomme cette API — voir
son propre `README.md`. Pour le suivi à jour des chantiers backend en cours
(parallélisation du traitement PDF, limite de concurrence sur les appels
Claude, etc.), voir `CLAUDE.md` à la racine du dépôt.
