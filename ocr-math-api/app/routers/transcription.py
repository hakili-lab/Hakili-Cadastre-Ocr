"""
transcription.py
Endpoints POST /transcribe (image) et POST /transcribe/pdf/start + GET /transcribe/pdf/status/{job_id}
(PDF, traité en arrière-plan avec suivi de progression par polling).
"""

import asyncio
import logging
from typing import Optional

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
from app.services.job_store import create_job, get_job, PDFJob
from app.utils.image_utils import (
    encode_bytes_to_base64,
    validate_content_type,
    resize_for_vision,
    normalize_orientation,
    read_upload_with_limit,
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
    """
    Pipeline commun : orientation → resize → base64 → Claude.
    `normalize_orientation`/`resize_for_vision` (PIL) sont des appels CPU
    synchrones ; les passer par `asyncio.to_thread` évite qu'ils ne bloquent
    la boucle d'événements pendant leur exécution (impact direct sur les
    autres requêtes concurrentes, ex. le polling de statut d'un autre job PDF).
    """
    raw_bytes = await asyncio.to_thread(normalize_orientation, raw_bytes, media_type)
    raw_bytes, image_width, image_height = await asyncio.to_thread(
        resize_for_vision, raw_bytes, media_type
    )
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

    try:
        raw_bytes = await read_upload_with_limit(file, settings.MAX_IMAGE_SIZE_MB, label="Image")
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


async def _process_page_and_track(
    idx: int,
    img_bytes: bytes,
    job: PDFJob,
    results: list[Optional[PageResult]],
    warnings: list[tuple[int, str]],
    errors: list[tuple[int, str]],
) -> None:
    """
    Traite une page et écrit son résultat à sa propre position (`results[idx]`)
    plutôt que de l'ajouter à une liste — les tâches, lancées en parallèle par
    `asyncio.gather` dans `_run_pdf_job`, terminent dans un ordre arbitraire,
    donc l'ordre des pages dans le résultat final doit être reconstruit par
    index plutôt que par ordre d'arrivée.

    `job.pages_done` est incrémenté ici, en effet de bord, dès la fin de CETTE
    page — pas après que `gather` a fini d'attendre toutes les pages. Comme
    `GET /pdf/status/{job_id}` lit `job.pages_done` directement sur l'objet
    partagé, la progression avance en temps réel pendant que d'autres pages
    sont encore en cours, sans qu'aucun verrou ne soit nécessaire (une seule
    boucle d'événements : rien d'autre ne peut s'exécuter entre la lecture et
    l'écriture de `job.pages_done`).
    """
    media_type = "image/png"  # convert_pdf_to_images produit du PNG
    page_number = idx + 1
    try:
        ocr_result, image_b64, w, h = await _process_single_image(img_bytes, media_type)
    except anthropic.APIError as exc:
        detail = describe_anthropic_error(exc)
        logger.error("Échec transcription page %d : %s", page_number, detail)
        warnings.append((idx, f"Page {page_number} : {detail}"))
        errors.append((idx, detail))
    except Exception as exc:
        logger.error("Échec transcription page %d : %s", page_number, exc)
        warnings.append((idx, f"Page {page_number} : échec de la transcription."))
        errors.append((idx, str(exc)))
    else:
        if ocr_result.final_warning:
            warnings.append((idx, f"Page {page_number} : {ocr_result.final_warning}"))
        results[idx] = PageResult(
            page_number=page_number,
            image_b64=image_b64,
            media_type=media_type,
            width=w,
            height=h,
            ocr=ocr_result,
        )
    finally:
        job.pages_done += 1


async def _run_pdf_job(job_id: str, page_images: list[tuple[bytes, int, int]]) -> None:
    """
    Traite les pages d'un PDF en parallèle via `asyncio.gather` — le nombre
    d'appels Anthropic réellement en vol reste borné par le sémaphore global
    de `claude_service.py` (`ANTHROPIC_CONCURRENCY`), pas par cette fonction :
    `gather` démarre toutes les tâches immédiatement, mais chacune n'entre
    dans son appel Claude qu'une fois une place de sémaphore obtenue.
    """
    job = get_job(job_id)
    if job is None:
        return

    results: list[Optional[PageResult]] = [None] * len(page_images)
    warnings: list[tuple[int, str]] = []
    errors: list[tuple[int, str]] = []

    try:
        await asyncio.gather(*(
            _process_page_and_track(idx, img_bytes, job, results, warnings, errors)
            for idx, (img_bytes, _orig_w, _orig_h) in enumerate(page_images)
        ))

        # Les tâches finissent dans un ordre arbitraire ; le résultat final
        # doit rester dans l'ordre des pages du PDF (tri par page_number,
        # jamais par ordre d'arrivée).
        pages = sorted((p for p in results if p is not None), key=lambda p: p.page_number)
        # Warnings/erreurs triés par index de page pour un message déterministe,
        # plutôt que dans l'ordre (arbitraire) de complétion des tâches.
        ordered_warnings = [msg for _idx, msg in sorted(warnings, key=lambda item: item[0])]

        if not pages and page_images:
            job.status = "error"
            # Dernier message par ordre de page (pas de complétion) réutilisé
            # comme job.error si AUCUNE page n'a réussi — sinon un job "done"
            # avec pages=[] laisse le frontend sur un écran vide sans message
            # ni moyen de revenir en arrière (AppContext.tsx :
            # transcriptionResult devient null, ResultScreen ne s'affiche jamais).
            job.error = (
                sorted(errors, key=lambda item: item[0])[-1][1]
                if errors
                else "La transcription a échoué pour toutes les pages du document."
            )
            return

        job.result = PDFTranscriptionResult(
            pages=pages,
            final_warning="\n".join(ordered_warnings) if ordered_warnings else None,
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

    try:
        raw_bytes = await read_upload_with_limit(file, settings.MAX_PDF_SIZE_MB, label="PDF")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    try:
        # convert_pdf_to_images (PyMuPDF) est un appel CPU synchrone ; via
        # asyncio.to_thread pour ne pas geler la boucle d'événements le temps
        # de rasteriser potentiellement des centaines de pages.
        page_images = await asyncio.to_thread(
            convert_pdf_to_images, raw_bytes, dpi=150, max_pages=settings.MAX_PDF_PAGES
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
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