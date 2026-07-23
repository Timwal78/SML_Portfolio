FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY rwa_engine.py .
COPY rwa_api_app.py .

ENV PORT=8080
ENV PYTHONUNBUFFERED=1

# Match live Render logs: gunicorn gthread on $PORT (WSGI Flask app)
CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT:-8080} --workers ${WEB_CONCURRENCY:-1} --threads 2 --worker-class gthread --timeout 120 --access-logfile - rwa_api_app:app"]
