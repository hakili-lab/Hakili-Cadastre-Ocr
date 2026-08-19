"""
job_store.py
Suivi en mémoire des jobs de transcription PDF en arrière-plan, pour permettre au frontend
de suivre la progression (nombre de pages traitées) par polling au lieu d'attendre une seule
requête HTTP bloquante jusqu'à la fin.

Limite connue : store en mémoire du process — convient à un serveur mono-process (dev / usage
personnel). Pour un déploiement multi-workers, il faudrait un store partagé (Redis, etc.).
"""

import uuid
from dataclasses import dataclass
from typing import Optional

from app.models.schemas import JobStatus, PDFTranscriptionResult


@dataclass
class PDFJob:
    job_id: str
    pages_total: int
    pages_done: int = 0
    status: JobStatus = "processing"
    result: Optional[PDFTranscriptionResult] = None
    error: Optional[str] = None


_jobs: dict[str, PDFJob] = {}


def create_job(pages_total: int) -> PDFJob:
    job = PDFJob(job_id=uuid.uuid4().hex, pages_total=pages_total)
    _jobs[job.job_id] = job
    return job


def get_job(job_id: str) -> Optional[PDFJob]:
    return _jobs.get(job_id)
