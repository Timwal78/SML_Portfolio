# VAPL Registry Service
# Serves the ProvenanceSoulManifest discovery endpoint and
# validates / aggregates VCs from registered agents.
#
# Build:  docker build -t vapl-registry .
# Run:    docker run -p 8400:8400 --env-file .env vapl-registry

FROM python:3.11-slim AS base

WORKDIR /app

# Install system deps for cryptography
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python deps first (layer-cache friendly)
COPY py-sdk/pyproject.toml py-sdk/README.md ./py-sdk/
COPY py-sdk/vapl/ ./py-sdk/vapl/
RUN pip install --no-cache-dir -e ./py-sdk

# Copy registry service
COPY deployment/registry_service.py ./

# Non-root user
RUN useradd -m -u 1001 vapl
USER vapl

EXPOSE 8400

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8400/health')" || exit 1

CMD ["python", "-u", "registry_service.py"]
