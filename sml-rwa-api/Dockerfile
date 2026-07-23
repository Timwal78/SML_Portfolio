FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY rwa_api_service.py .

ENV PORT=8080
ENV PYTHONUNBUFFERED=1

# Render sets PORT; bind 0.0.0.0:$PORT. Single worker is fine for this API.
CMD ["sh", "-c", "gunicorn -k uvicorn.workers.UvicornWorker --workers 2 --timeout 60 --bind 0.0.0.0:${PORT:-8080} --access-logfile - rwa_api_service:app"]
