# syntax=docker/dockerfile:1.7
# Build context is the repo root (see .github/workflows/agent-deploy.yml and the
# docker build invocation). This is required because app/core/tools/registry.py
# resolves the shared schema at <repo-root>/schemas/roadmap-ai-operations.schema.json.

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8080 \
    APP_ENV=production

WORKDIR /app

COPY agent/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY agent/app ./app
COPY agent/run.py ./run.py
COPY schemas /schemas

RUN useradd --create-home --shell /usr/sbin/nologin app \
    && chown -R app:app /app /schemas
USER app

EXPOSE 8080

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
