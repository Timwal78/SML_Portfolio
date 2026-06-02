# NLWeb on Render — turns scriptmasterlabs.com into a queryable agentic endpoint.
# Exposes /ask (REST, human + agent) and /mcp (Model Context Protocol).
# Reference implementation: https://github.com/microsoft/NLWeb

FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# Pull the Microsoft NLWeb reference implementation
RUN git clone --depth 1 https://github.com/microsoft/NLWeb.git .

# Install deps
RUN pip install --no-cache-dir -r AskAgent/python/requirements.txt

# Your config (mounted/copied below) tells NLWeb what data to ingest + which LLM/vector store to use
# The aiohttp_server defaults to config/config_webserver.yaml relative to the repo root
COPY config.yaml /app/config/config_webserver.yaml

ENV PORT=8000
EXPOSE 8000

ENV PYTHONPATH=/app/AskAgent/python

WORKDIR /app/AskAgent/python

# Start the NLWeb server
CMD ["python", "-m", "webserver.aiohttp_server"]
