# NLWeb on Render — turns scriptmasterlabs.com into a queryable agentic endpoint.
# Exposes /ask (REST, human + agent) and /mcp (Model Context Protocol).
# Reference implementation: https://github.com/microsoft/NLWeb

FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# Pull the Microsoft NLWeb reference implementation
RUN git clone --depth 1 https://github.com/microsoft/NLWeb.git .

# Install deps (path may be code/ in the repo; adjust if the layout changed)
RUN pip install --no-cache-dir -r requirements.txt || pip install --no-cache-dir -r code/requirements.txt

# Your config (mounted/copied below) tells NLWeb what data to ingest + which LLM/vector store to use
COPY config.yaml /app/config/config.yaml

ENV PORT=8000
EXPOSE 8000

# Start the NLWeb server (entrypoint name may vary by repo version — check README)
CMD ["python", "-m", "code.app", "--config", "/app/config/config.yaml", "--port", "8000"]
