# syntax=docker/dockerfile:1
FROM python:3.12.7-slim-bookworm AS builder

WORKDIR /app

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt


FROM python:3.12.7-slim-bookworm

# Librairies système requises par WeasyPrint (app/services/pdf_export_service.py)
# pour le layout/texte (Pango + HarfBuzz) et les polices utilisées par le
# template d'export ("DejaVu Sans") — c'est justement ce que l'installation
# native manuelle sur Windows évite d'avoir à faire.
RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        libpango-1.0-0 \
        libpangoft2-1.0-0 \
        fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 1000 appuser \
    && useradd --uid 1000 --gid appuser --create-home --shell /bin/bash appuser

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app
COPY app ./app

# data/ est monté en volume au démarrage (voir docker-compose.yml) ; ce
# répertoire n'existe que pour que le conteneur ait un point de montage
# avec les bonnes permissions avant que le volume ne soit attaché.
RUN mkdir -p /app/data && chown -R appuser:appuser /app

USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
