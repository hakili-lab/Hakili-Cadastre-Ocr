"""
schemas.py
Modèles Pydantic pour la validation stricte des données entrantes et sortantes.
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

JobStatus = Literal["processing", "done", "error"]
"""État d'un job de transcription PDF — partagé entre `job_store.PDFJob` et `PDFJobStatusResponse`."""


class BoundingBox(BaseModel):
    """Coordonnées normalisées (0 à 1) d'un bloc dans l'image."""

    x_min: float = Field(..., ge=0, le=1)
    y_min: float = Field(..., ge=0, le=1)
    x_max: float = Field(..., ge=0, le=1)
    y_max: float = Field(..., ge=0, le=1)

    @field_validator("x_min", "y_min", "x_max", "y_max", mode="before")
    @classmethod
    def clamp_to_unit_range(cls, v: float) -> float:
        try:
            v = float(v)
        except (TypeError, ValueError):
            return v
        return max(0.0, min(1.0, v))

    @field_validator("x_max")
    @classmethod
    def x_max_must_exceed_x_min(cls, v: float, info) -> float:
        x_min = info.data.get("x_min")
        if x_min is not None and v < x_min:
            raise ValueError("x_max doit être supérieur ou égal à x_min")
        return v

    @field_validator("y_max")
    @classmethod
    def y_max_must_exceed_y_min(cls, v: float, info) -> float:
        y_min = info.data.get("y_min")
        if y_min is not None and v < y_min:
            raise ValueError("y_max doit être supérieur ou égal à y_min")
        return v


class Block(BaseModel):
    """Un bloc de contenu mathématique identifié dans la copie."""

    id: int
    label: str
    markdown: str
    bbox: BoundingBox
    confidence: int = Field(..., ge=0, le=100)


class OCRResult(BaseModel):
    """Résultat OCR d'une seule page."""

    blocks: list[Block]
    final_warning: Optional[str] = None


class PageResult(BaseModel):
    """Résultat OCR d'une page + image encodée."""

    page_number: int
    image_b64: str
    media_type: str
    width: int
    height: int
    ocr: OCRResult


class PDFTranscriptionResult(BaseModel):
    """Résultat complet d'un PDF multi-pages."""

    pages: list[PageResult]
    final_warning: Optional[str] = None


class TranscriptionResponse(BaseModel):
    """Enveloppe de réponse de l'endpoint /transcribe (image unique)."""

    success: bool = True
    result: OCRResult


class ErrorResponse(BaseModel):
    """Format standard des erreurs renvoyées par l'API."""

    success: bool = False
    error: str
    detail: Optional[str] = None


class PDFJobStartResponse(BaseModel):
    """Réponse à la création d'un job de transcription PDF (traitement en arrière-plan)."""

    job_id: str
    pages_total: int


class PDFJobStatusResponse(BaseModel):
    """État d'avancement d'un job de transcription PDF, interrogé par polling."""

    job_id: str
    status: JobStatus
    pages_done: int
    pages_total: int
    result: Optional[PDFTranscriptionResult] = None
    error: Optional[str] = None


class CorrectionResponse(BaseModel):
    """Confirmation d'enregistrement d'une correction (image + avant/après + erreur)."""

    id: str


class ExportPdfRequest(BaseModel):
    """Corps de POST /export/pdf : le fragment HTML déjà rendu (React + KaTeX) côté frontend."""

    html: str = Field(..., min_length=1)