FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# System deps:
#   git + curl — for cloning repos and downloading scanner binaries
#   libpango, libcairo, libgdk-pixbuf — required by WeasyPrint for PDF rendering
#   fonts-liberation — base fonts for PDF output
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates \
    libpango-1.0-0 libpangocairo-1.0-0 libcairo2 \
    libgdk-pixbuf-2.0-0 libffi-dev \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# ── Trivy ──────────────────────────────────────────────────────────────────────
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       wget \
       gnupg \
       apt-transport-https \
    && wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key \
       | gpg --dearmor -o /usr/share/keyrings/trivy.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/trivy.gpg] https://aquasecurity.github.io/trivy-repo/deb generic main" \
       > /etc/apt/sources.list.d/trivy.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends trivy \
    && rm -rf /var/lib/apt/lists/*

# ── Gitleaks ───────────────────────────────────────────────────────────────────
RUN curl -sSfL \
    https://github.com/gitleaks/gitleaks/releases/download/v8.21.1/gitleaks_8.21.1_linux_x64.tar.gz \
    -o /tmp/gitleaks.tar.gz \
    && tar -xzf /tmp/gitleaks.tar.gz -C /usr/local/bin gitleaks \
    && rm /tmp/gitleaks.tar.gz \
    && chmod +x /usr/local/bin/gitleaks

# ── Python deps (includes bandit, semgrep, weasyprint) ────────────────────────
COPY requirements.txt .
RUN pip install --upgrade pip setuptools && pip install -r requirements.txt

COPY . .

# Verify all four scanners present at build time
RUN bandit --version \
    && semgrep --version \
    && trivy --version \
    && gitleaks version \
    || echo "WARNING: one or more scanner version checks failed — see build log above"

# ── C6: least privilege — run as non-root (no new base image/layers) ──────
RUN useradd -u 10000 -m sentinel \
    && mkdir -p /tmp/sentinel-workspaces \
    && chown -R 10000:10000 /app /tmp/sentinel-workspaces
USER 10000

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
