"""
security.py
Authentification par clé API partagée entre le frontend et ce backend
(header `X-API-Key`) — distincte d'ANTHROPIC_API_KEY, qui authentifie ce
backend auprès de l'API Anthropic. Protège contre l'appel direct et anonyme
de l'API par quiconque découvre son URL ; n'est PAS un secret côté client
une fois buildé dans le frontend (toute variable VITE_* est visible dans le
bundle JavaScript livré au navigateur) — voir hakili-ocr/README.md.
"""

from fastapi import HTTPException, Security, status
from fastapi.security import APIKeyHeader

from app.config import get_settings

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def verify_api_key(provided_key: str | None = Security(_api_key_header)) -> None:
    """
    Lève 401 si la clé fournie est absente, incorrecte, ou si APP_API_KEY
    n'est pas configuré côté serveur — refuse tout par défaut plutôt que
    d'accepter silencieusement les requêtes si la variable a été oubliée.
    """
    settings = get_settings()
    if not settings.APP_API_KEY or provided_key != settings.APP_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Clé API invalide ou manquante.",
        )
