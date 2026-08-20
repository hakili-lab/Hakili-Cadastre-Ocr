"""
transcription.py
Endpoints POST /transcribe (image) et POST /transcribe/pdf/start + GET /transcribe/pdf/status/{job_id}
(PDF, traité en arrière-plan avec suivi de progression par polling).
"""

import asyncio
import logging
import time

import anthropic
from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, status

from app.config import get_settings
from app.models.schemas import (
    ErrorResponse,
    TranscriptionResponse,
    PDFJobStartResponse,
    PDFJobStatusResponse,
    PDFTranscriptionResult,
    PageResult,
    PDFChunkedStartRequest,
    PDFChunkAckResponse,
)
from app.security import verify_api_key
from app.services.claude_service import call_anthropic_ocr, describe_anthropic_error
from app.services.job_store import create_job, create_chunked_job, get_job, PDFJob
from app.utils.image_utils import (
    encode_bytes_to_base64,
    validate_content_type,
    resize_for_vision,
    normalize_orientation,
    read_upload_with_limit,
    read_upload_with_byte_limit,
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
    page_number: int,
    img_bytes: bytes,
    job: PDFJob,
    results: dict[int, PageResult],
    warnings: list[tuple[int, str]],
    errors: list[tuple[int, str]],
) -> None:
    """
    Traite une page et écrit son résultat dans `results[page_number]` — un
    dict indexé par numéro de page (pas par ordre d'arrivée), car les tâches,
    lancées en parallèle par `asyncio.gather`, terminent dans un ordre
    arbitraire : le résultat final doit être reconstruit par numéro de page,
    jamais par ordre de complétion. Réutilisé tel quel par les deux flux PDF :
    `_run_pdf_job` (flux "legacy", un seul appel avec toutes les pages
    connues d'avance) et `_process_chunk_pages` (flux "chunké", un appel par
    morceau reçu — `results`/`warnings`/`errors` sont alors les champs
    persistants de `job`, accumulés au fil de plusieurs vagues successives,
    pas des listes locales à un seul appel).

    `job.pages_done` est incrémenté ici, en effet de bord, dès la fin de CETTE
    page — pas après qu'un `gather` englobant ait fini d'attendre toutes les
    pages d'un coup. Comme `GET /pdf/status/{job_id}` lit `job.pages_done`
    directement sur l'objet partagé, la progression avance en temps réel
    pendant que d'autres pages sont encore en cours, sans qu'aucun verrou ne
    soit nécessaire (une seule boucle d'événements : rien d'autre ne peut
    s'exécuter entre la lecture et l'écriture de `job.pages_done`, ni entre
    lecture et écriture d'une clé de `results`).
    """
    media_type = "image/png"  # convert_pdf_to_images produit du PNG
    try:
        ocr_result, image_b64, w, h = await _process_single_image(img_bytes, media_type)
    except anthropic.APIError as exc:
        detail = describe_anthropic_error(exc)
        logger.error("Échec transcription page %d : %s", page_number, detail)
        warnings.append((page_number, f"Page {page_number} : {detail}"))
        errors.append((page_number, detail))
    except Exception as exc:
        logger.error("Échec transcription page %d : %s", page_number, exc)
        warnings.append((page_number, f"Page {page_number} : échec de la transcription."))
        errors.append((page_number, str(exc)))
    else:
        if ocr_result.final_warning:
            warnings.append((page_number, f"Page {page_number} : {ocr_result.final_warning}"))
        results[page_number] = PageResult(
            page_number=page_number,
            image_b64=image_b64,
            media_type=media_type,
            width=w,
            height=h,
            ocr=ocr_result,
        )
    finally:
        job.pages_done += 1


def _finalize_pdf_job(job: PDFJob, results: dict[int, PageResult], warnings: list[tuple[int, str]],
                       errors: list[tuple[int, str]]) -> None:
    """
    Fabrique `job.result`/`job.status` à partir des résultats/avertissements/erreurs
    accumulés, triés par numéro de page pour un ordre et un message déterministes
    (jamais par ordre — arbitraire — de complétion des tâches). Partagé par
    `_run_pdf_job` (fin du seul `gather`) et `_maybe_finalize_job` (fin du
    dernier morceau d'un job chunké) pour que les deux flux produisent un
    `PDFTranscriptionResult` strictement identique en forme.
    """
    if not results:
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

    pages = sorted(results.values(), key=lambda p: p.page_number)
    ordered_warnings = [msg for _pn, msg in sorted(warnings, key=lambda item: item[0])]
    job.result = PDFTranscriptionResult(
        pages=pages,
        final_warning="\n".join(ordered_warnings) if ordered_warnings else None,
    )
    job.status = "done"


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

    results: dict[int, PageResult] = {}
    warnings: list[tuple[int, str]] = []
    errors: list[tuple[int, str]] = []

    try:
        await asyncio.gather(*(
            _process_page_and_track(idx + 1, img_bytes, job, results, warnings, errors)
            for idx, (img_bytes, _orig_w, _orig_h) in enumerate(page_images)
        ))
        _finalize_pdf_job(job, results, warnings, errors)
    except Exception as exc:
        logger.exception("Échec inattendu du job PDF %s", job_id)
        job.status = "error"
        job.error = str(exc)


async def _process_chunk_pages(job_id: str, page_images: list[tuple[bytes, int, int]], start_page_number: int) -> None:
    """
    Traite les pages d'UN morceau reçu par POST /pdf/{job_id}/chunk — même
    motif que `_run_pdf_job` (un `asyncio.gather` sur `_process_page_and_track`
    par page), mais écrit dans `job.results`/`job.warnings`/`job.errors`
    (partagés entre TOUS les morceaux du job) plutôt que dans des listes
    locales à cet appel : un job chunké accumule ses résultats au fil de
    plusieurs vagues de tâches successives, une par morceau reçu, pas d'un
    seul `gather` englobant tout le document. Décrémente `job.chunks_pending`
    et tente la finalisation du job à sa propre fin — voir `_maybe_finalize_job`.
    """
    job = get_job(job_id)
    if job is None:
        return
    try:
        await asyncio.gather(*(
            _process_page_and_track(start_page_number + i, img_bytes, job, job.results, job.warnings, job.errors)
            for i, (img_bytes, _w, _h) in enumerate(page_images)
        ))
    finally:
        job.chunks_pending -= 1
        job.updated_at = time.time()
        _maybe_finalize_job(job)


def _maybe_finalize_job(job: PDFJob) -> None:
    """
    Appelée à la fin du traitement de CHAQUE morceau (pas seulement le
    dernier envoyé) : le morceau dont le traitement se termine EN DERNIER
    dans le temps réel n'est pas forcément celui envoyé en dernier (un petit
    morceau envoyé tôt peut finir de traiter après un gros morceau envoyé
    plus tard). Le job passe à done/error dès que les deux conditions sont
    réunies : plus aucun morceau en vol (`chunks_pending == 0`) ET le client
    a signalé qu'il n'enverra plus de morceau (`upload_finalized`). Aucun
    `gather` global n'attend ça ici : chaque appelant (`_process_chunk_pages`)
    vérifie juste, à sa propre fin, s'IL est celui qui fait passer
    `chunks_pending` à 0 — sûr sans verrou car aucun `await` ne s'intercale
    entre la décrémentation et ce test (une seule boucle d'événements).
    """
    if job.status != "processing" or not job.upload_finalized or job.chunks_pending > 0:
        return
    job.pages_total = job.pages_received  # corrige l'estimation pages_expected par le compte réel
    _finalize_pdf_job(job, job.results, job.warnings, job.errors)


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


# ─── Upload PDF par morceaux (chunked) ──────────────────────────────────
#
# Alternative à /pdf/start pour les gros documents : au lieu d'envoyer le
# fichier entier en un seul POST bloquant (upload puis traitement,
# strictement séquentiels), le client découpe le PDF en sous-PDF côté client
# (pdf-lib, aucun rendu de pixel) et les envoie un par un via /pdf/{job_id}/chunk.
# Le backend rasterise et lance le traitement Claude de chaque morceau dès
# réception, sans attendre les suivants — le traitement du morceau N se
# poursuit en tâche de fond pendant que le morceau N+1 est envoyé. Réutilise
# la même GET /pdf/status/{job_id} que le flux classique : aucun changement
# nécessaire côté polling.


@router.post(
    "/pdf/start-chunked",
    response_model=PDFJobStartResponse,
    responses={
        422: {"model": ErrorResponse, "description": "pages_expected invalide"},
    },
)
async def start_chunked_pdf_transcription(body: PDFChunkedStartRequest) -> PDFJobStartResponse:
    """
    Ouvre un job PDF alimenté par plusieurs morceaux envoyés successivement
    (voir POST /pdf/{job_id}/chunk) plutôt que par un fichier complet en un
    seul POST — pensé pour les gros documents, où attendre la fin de
    l'upload avant de commencer le traitement gaspille du temps (upload et
    traitement Claude peuvent alors se chevaucher au lieu de s'enchaîner).
    Ne reçoit aucun fichier : juste le nombre de pages annoncé par le client
    (connu côté client via pdf-lib avant tout envoi). `create_chunked_job`
    plafonne cette valeur à MAX_PDF_PAGES avant d'en faire le budget de
    pages cumulé du job pour tous les morceaux à venir.
    """
    job = create_chunked_job(pages_expected=body.pages_expected)
    return PDFJobStartResponse(job_id=job.job_id, pages_total=job.pages_total)


@router.post(
    "/pdf/{job_id}/chunk",
    response_model=PDFChunkAckResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Morceau invalide ou budget dépassé"},
        404: {"model": ErrorResponse, "description": "Job introuvable"},
        409: {"model": ErrorResponse, "description": "Job non receveur ou morceau concurrent"},
    },
)
async def upload_pdf_chunk(
    job_id: str,
    file: UploadFile,
    is_last_chunk: bool = Form(False),
) -> PDFChunkAckResponse:
    """
    Reçoit un morceau (sous-PDF, quelques pages) d'un job ouvert par
    /pdf/start-chunked. Les morceaux doivent être envoyés strictement l'un
    après l'autre (le client n'envoie le morceau N+1 qu'une fois la réponse
    du morceau N reçue) — c'est ce qui permet au traitement Claude du
    morceau N de continuer en tâche de fond pendant que N+1 est en cours
    d'envoi, sans jamais avoir besoin d'un numéro d'ordre annoncé par le
    client : `job.pages_received` est l'unique source de vérité sur la
    numérotation des pages, calculée côté serveur.

    `job.lock` rejette activement (409) tout morceau qui arriverait pendant
    que le précédent est encore en cours de lecture/rasterisation pour ce
    même job, plutôt que de le mettre en file d'attente silencieusement —
    un tel chevauchement signale une violation du contrat d'envoi séquentiel
    côté client (bug, double-clic, requête retentée) qu'il vaut mieux
    remonter que masquer.

    NOTE (étape 5 du plan) : cette version ne fait que la comptabilité —
    réception, validation de budget, rasterisation — sans encore lancer le
    traitement OCR des pages (étape 6).
    """
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job introuvable.")

    if job.pages_expected is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ce job n'a pas été ouvert en mode upload par morceaux.",
        )
    if job.status != "processing" or job.upload_finalized:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ce job n'accepte plus de nouveaux morceaux.",
        )
    if job.lock.locked():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Un morceau est déjà en cours de réception pour ce job — envoyez les morceaux un par un.",
        )

    if file.content_type is None or "pdf" not in file.content_type.lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Le morceau doit être un PDF.",
        )

    settings = get_settings()
    async with job.lock:
        remaining_bytes = max(0, int(settings.MAX_PDF_SIZE_MB * 1024 * 1024) - job.bytes_received)
        try:
            chunk_bytes = await read_upload_with_byte_limit(file, remaining_bytes, label="Morceau PDF")
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

        remaining_pages = max(0, job.pages_expected - job.pages_received)
        try:
            # convert_pdf_to_images (PyMuPDF) est un appel CPU synchrone ; via
            # asyncio.to_thread pour ne pas geler la boucle d'événements.
            page_images = await asyncio.to_thread(
                convert_pdf_to_images, chunk_bytes, dpi=150, max_pages=remaining_pages
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("Échec de la conversion d'un morceau PDF (job %s)", job_id)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Impossible de convertir ce morceau : {exc}",
            ) from exc

        start_page_number = job.pages_received + 1
        job.pages_received += len(page_images)
        job.bytes_received += len(chunk_bytes)
        if is_last_chunk:
            job.upload_finalized = True
        job.chunks_pending += 1
        job.updated_at = time.time()

    task = asyncio.create_task(_process_chunk_pages(job.job_id, page_images, start_page_number))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    return PDFChunkAckResponse(job_id=job.job_id, pages_received=job.pages_received, status=job.status)