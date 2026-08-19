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
    MAX_TOKENS: int = int(os.getenv("MAX_TOKENS", "4096"))
    # Origines autorisées par CORS, séparées par des virgules. Par défaut les
    # ports Vite en dev local ; à surcharger en déploiement (ex. l'origine du
    # frontend dockerisé) via la variable d'environnement ALLOWED_ORIGINS.
    ALLOWED_ORIGINS: list[str] = [
        origin.strip()
        for origin in os.getenv(
            "ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:5174"
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
