from celery import Celery
from app.core.config import settings

celery_app = Celery("sentinel", broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND, include=["app.workers.tasks"])

celery_app.conf.update(task_serializer="json", result_serializer="json", accept_content=["json"],
    timezone="UTC", enable_utc=True, task_track_started=True,
    # C4: hard + soft ceilings so a hung scanner/AI call fails loudly
    # instead of pinning a worker slot forever.
    task_time_limit=settings.SCANNER_TIMEOUT_SECONDS * 5,
    task_soft_time_limit=settings.SCANNER_TIMEOUT_SECONDS * 4,
    worker_prefetch_multiplier=1, task_acks_late=True)
