# Render service settings (required)

Dashboard → sml-rwa-api → Settings:

| Field | Value |
|-------|-------|
| Repo | Timwal78/SML_Portfolio |
| Branch | main |
| **Root Directory** | **sml-rwa-api** |
| Runtime | Docker |
| Dockerfile Path | ./Dockerfile |
| Health Check Path | /health |

If Root Directory is empty/repo root, Render builds the wrong app and keeps serving the old fake-402 binary.

After deploy, health must show `"version":"1.1.1"` and
`GET /x402/rwa-valuation?asset_id=rwa-000001` must return HTTP 402 with `PAYMENT-REQUIRED` header.
