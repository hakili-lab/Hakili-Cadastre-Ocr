"""
transcription.py
Endpoints POST /transcribe (image) et POST /transcribe/pdf/start + GET /transcribe/pdf/status/{job_id}
(PDF, traité en arrière-plan avec suivi de progression par polling).
"""

import asyncio
import logging

import anthropic
from fastapi import APIRouter, Depends, HTTPException, UploadFile, status

from app.config import get_settings
from app.models.schemas import (
    ErrorResponse,
    TranscriptionResponse,
    PDFJobStartResponse,
    PDFJobStatusResponse,
    PDFTranscriptionResult,
    PageResult,
)
from app.security import verify_api_key
from app.services.claude_service import call_anthropic_ocr, describe_anthropic_error
from app.services.job_store import create_job, get_job
from app.utils.image_utils import (
    encode_bytes_to_base64,
    validate_content_type,
    resize_for_vision,
    normalize_orientation,
    validate_size,
    convert_pdf_to_images,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/transcribe", tags=["transcription"], dependencies=[Depends(verify_api_key)])

# asyncio ne garde qu'une référence faible aux tasks créées par create_task : sans
# rien d'autre qui la référence, une task "fire-and-forget" peut être supprimée par
# le garbage collector en plein milieu de son exécution. On garde donc une référence
# forte le temps du job, retirée automatiquement à la fin via add_done_callback.
_background_tasks: set[asyncio.Task] = set()


async def _process_single_image(raw_bytes: bytes, media_type: str):
    """Pipeline commun : orientation → resize → base64 → Claude."""
    raw_bytes = normalize_orientation(raw_bytes, media_type)
    raw_bytes, image_width, image_height = resize_for_vision(raw_bytes, media_type)
    image_b64 = encode_bytes_to_base64(raw_bytes)
    ocr_result = await call_anthropic_ocr(image_b64, media_type, image_width, image_height)
    return ocr_result, image_b64, image_width, image_height


@router.post(
    "",
    response_model=TranscriptionResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Fichier invalide"},
        422: {"model": ErrorResponse, "description": "Réponse Claude invalide"},
        500: {"model": ErrorResponse, "description": "Erreur serveur ou API Anthropic"},
    },
)
async def transcribe_image(file: UploadFile) -> TranscriptionResponse:
    settings = get_settings()

    if file.content_type is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Impossible de déterminer le type du fichier envoyé.",
        )

    try:
        media_type = validate_content_type(file.content_type)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    raw_bytes = await file.read()
    try:
        validate_size(raw_bytes, settings.MAX_IMAGE_SIZE_MB)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    try:
        ocr_result, _, _, _ = await _process_single_image(raw_bytes, media_type)
    except ValueError as exc:
        logger.error("Réponse Claude invalide : %s", exc)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    except RuntimeError as exc:
        logger.error("Erreur de configuration : %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc
    except anthropic.APIError as exc:
        logger.exception("Erreur API Anthropic")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=describe_anthropic_error(exc),
        ) from exc
    except Exception as exc:
        logger.exception("Erreur inattendue lors de la transcription")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erreur inattendue : {exc}",
        ) from exc

    return TranscriptionResponse(success=True, result=ocr_result)


async def _run_pdf_job(job_id: str, page_images: list[tuple[bytes, int, int]]) -> None:
    """
    Traite les pages d'un PDF une par une et met à jour le job après chaque page,
    pour que /pdf/status/{job_id} reflète une progression réelle.
    """
    job = get_job(job_id)
    if job is None:
        return

    pages: list[PageResult] = []
    global_warnings: list[str] = []
    # Dernier message d'échec par page, réutilisé comme job.error si AUCUNE page
    # n'a réussi (cf. plus bas) — sinon un job "done" avec pages=[] laisse le
    # frontend sur un écran vide sans message ni moyen de revenir en arrière
    # (AppContext.tsx : transcriptionResult devient null, ResultScreen ne
    # s'affiche jamais).
    last_page_error: str | None = None

    try:
        for idx, (img_bytes, orig_w, orig_h) in enumerate(page_images, start=1):
            media_type = "image/png"  # convert_pdf_to_images produit du PNG
            try:
                ocr_result, image_b64, w, h = await _process_single_image(img_bytes, media_type)
            except anthropic.APIError as exc:
                detail = describe_anthropic_error(exc)
                logger.error("Échec transcription page %d : %s", idx, detail)
                global_warnings.append(f"Page {idx} : {detail}")
                last_page_error = detail
                job.pages_done = idx
                continue
            except Exception as exc:
                logger.error("Échec transcription page %d : %s", idx, exc)
                global_warnings.append(f"Page {idx} : échec de la transcription.")
                last_page_error = str(exc)
                job.pages_done = idx
                continue

            if ocr_result.final_warning:
                global_warnings.append(f"Page {idx} : {ocr_result.final_warning}")

            pages.append(
                PageResult(
                    page_number=idx,
                    image_b64=image_b64,
                    media_type=media_type,
                    width=w,
                    height=h,
                    ocr=ocr_result,
                )
            )
            job.pages_done = idx

        if not pages and page_images:
            job.status = "error"
            job.error = last_page_error or "La transcription a échoué pour toutes les pages du document."
            return

        job.result = PDFTranscriptionResult(
            pages=pages,
            final_warning="\n".join(global_warnings) if global_warnings else None,
        )
        job.status = "done"
    except Exception as exc:
        logger.exception("Échec inattendu du job PDF %s", job_id)
        job.status = "error"
        job.error = str(exc)


@router.post(
    "/pdf/start",
    response_model=PDFJobStartResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Fichier invalide"},
    },
)
async def start_pdf_transcription(file: UploadFile) -> PDFJobStartResponse:
    """
    Reçoit un PDF, le décompose en images, démarre le traitement en arrière-plan
    et retourne immédiatement un job_id à interroger via GET /pdf/status/{job_id}.
    """
    settings = get_settings()

    if file.content_type is None or "pdf" not in file.content_type.lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Le fichier doit être un PDF.",
        )

    raw_bytes = await file.read()
    size_mb = len(raw_bytes) / (1024 * 1024)
    if size_mb > settings.MAX_IMAGE_SIZE_MB * 4:  # PDF peut être plus lourd
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"PDF trop lourd ({size_mb:.1f} Mo). Limite : {settings.MAX_IMAGE_SIZE_MB * 4:.0f} Mo.",
        )

    try:
        page_images = convert_pdf_to_images(raw_bytes, dpi=150)
    except Exception as exc:
        logger.exception("Échec de la conversion PDF")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Impossible de convertir le PDF : {exc}",
        ) from exc

    if not page_images:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Le PDF ne contient aucune page.",
        )

    job = create_job(pages_total=len(page_images))
    task = asyncio.create_task(_run_pdf_job(job.job_id, page_images))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    return PDFJobStartResponse(job_id=job.job_id, pages_total=job.pages_total)


@router.get(
    "/pdf/status/{job_id}",
    response_model=PDFJobStatusResponse,
    responses={404: {"model": ErrorResponse, "description": "Job introuvable"}},
)
async def get_pdf_transcription_status(job_id: str) -> PDFJobStatusResponse:
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job introuvable.")

    return PDFJobStatusResponse(
        job_id=job.job_id,
        status=job.status,
        pages_done=job.pages_done,
        pages_total=job.pages_total,
        result=job.result,
        error=job.error,
    )