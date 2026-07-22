FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y postgresql-client && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import httpx; httpx.get('http://localhost:8183/health')" || exit 1

CMD ["gunicorn", "--workers", "4", "--threads", "2", "--timeout", "30", "--bind", "0.0.0.0:8183", "--access-logfile", "-", "rwa_api_service:app"]
