# Swarm MM — Dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV SWARM_MM_HOST=0.0.0.0
ENV SWARM_MM_PORT=8088
ENV SWARM_MM_DEV_OPEN=0
EXPOSE 8088
CMD ["uvicorn", "swarm_mm.api.app:app", "--host", "0.0.0.0", "--port", "8088"]
