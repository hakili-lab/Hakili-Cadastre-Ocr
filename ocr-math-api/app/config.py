"""
config.py
Chargement centralisé de la configuration de l'application via variables d'environnement.
"""

import os
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


class Settings:
    """Configuration globale de l'application, lue depuis les variables d'environnement."""

    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    # Clé partagée frontend → backend (distincte d'ANTHROPIC_API_KEY, qui est
    # backend → Anthropic) : voir app/security.py pour la dépendance qui la vérifie.
    APP_API_KEY: str = os.getenv("APP_API_KEY", "")
    MODEL: str = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")
    MAX_IMAGE_SIZE_MB: float = float(os.getenv("MAX_IMAGE_SIZE_MB", "5"))
    # PDF : limite dédiée plutôt que dérivée de MAX_IMAGE_SIZE_MB, car un PDF
    # long/haute résolution n'a pas la même échelle qu'une image unique.
    MAX_PDF_SIZE_MB: float = float(os.getenv("MAX_PDF_SIZE_MB", "500"))
    MAX_PDF_PAGES: int = int(os.getenv("MAX_PDF_PAGES", "600"))
    # Durée (secondes) après laquelle un job PDF terminé (done/error) est
    # purgé du store en mémoire — évite une croissance indéfinie de job_store
    # sur un process qui tourne longtemps. Défaut : 4h.
    JOB_TTL_SECONDS: int = int(os.getenv("JOB_TTL_SECONDS", "14400"))
    # Durée (secondes) sans nouveau morceau reçu au-delà de laquelle un job PDF
    # "chunké" (upload_finalized=False) est considéré bloqué et purgé — sans ça,
    # un client qui abandonne un upload par morceaux en cours de route (onglet
    # fermé, connexion coupée) laisserait un job "processing" indéfiniment
    # impurgeable (job_store._purge_expired_jobs ne balaie aujourd'hui que
    # done/error). Défaut : 30 min.
    JOB_STALL_TIMEOUT_SECONDS: int = int(os.getenv("JOB_STALL_TIMEOUT_SECONDS", "1800"))
    MAX_TOKENS: int = int(os.getenv("MAX_TOKENS", "4096"))
    # Nombre max d'appels Anthropic simultanés (sémaphore global, claude_service.py).
    # Protège contre le rate limit Anthropic (429) et les pics de coût lors du
    # traitement parallèle des pages d'un PDF (_run_pdf_job).
    ANTHROPIC_CONCURRENCY: int = int(os.getenv("ANTHROPIC_CONCURRENCY", "6"))
    # Origines autorisées par CORS, séparées par des virgules. Par défaut les
    # ports Vite en dev local ; à surcharger en déploiement (ex. l'origine du
    # frontend dockerisé) via la variable d'environnement ALLOWED_ORIGINS.
    ALLOWED_ORIGINS: list[str] = [
        origin.strip()
        for origin in os.getenv(
            "ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:5174,http://localhost:8021"
        ).split(",")
        if origin.strip()
    ]

    def validate(self) -> None:
        """Vérifie que les variables critiques sont bien définies."""
        if not self.ANTHROPIC_API_KEY:
            raise RuntimeError(
                "Clé API Anthropic manquante. Définissez la variable d'environnement "
                "ANTHROPIC_API_KEY (fichier .env ou variable système)."
            )


@lru_cache
def get_settings() -> Settings:
    """Retourne une instance mise en cache des settings (évite de relire l'env à chaque appel)."""
    settings = Settings()
    return settings
