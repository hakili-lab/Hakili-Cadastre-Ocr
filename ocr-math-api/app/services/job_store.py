"""
job_store.py
Suivi en mémoire des jobs de transcription PDF en arrière-plan, pour permettre au frontend
de suivre la progression (nombre de pages traitées) par polling au lieu d'attendre une seule
requête HTTP bloquante jusqu'à la fin.

Limite connue : store en mémoire du process — convient à un serveur mono-process (dev / usage
personnel). Pour un déploiement multi-workers, il faudrait un store partagé (Redis, etc.).
"""

import time
import uuid
from dataclasses import dataclass, field
from typing import Optional

from app.config import get_settings
from app.models.schemas import JobStatus, PDFTranscriptionResult


@dataclass
class PDFJob:
    job_id: str
    pages_total: int
    pages_done: int = 0
    status: JobStatus = "processing"
    result: Optional[PDFTranscriptionResult] = None
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)


_jobs: dict[str, PDFJob] = {}


def _purge_expired_jobs() -> None:
    """
    Supprime les jobs terminés (done/error) plus vieux que JOB_TTL_SECONDS.
    Appelé à chaque création de job plutôt que via une tâche planifiée à part :
    le store est en mémoire de process, donc un balayage opportuniste au fil
    des créations suffit à empêcher sa croissance indéfinie.
    """
    ttl = get_settings().JOB_TTL_SECONDS
    now = time.time()
    expired = [
        job_id
        for job_id, job in _jobs.items()
        if job.status in ("done", "error") and now - job.created_at > ttl
    ]
    for job_id in expired:
        del _jobs[job_id]


def create_job(pages_total: int) -> PDFJob:
    _purge_expired_jobs()
    job = PDFJob(job_id=uuid.uuid4().hex, pages_total=pages_total)
    _jobs[job.job_id] = job
    return job


def get_job(job_id: str) -> Optional[PDFJob]:
    return _jobs.get(job_id)
