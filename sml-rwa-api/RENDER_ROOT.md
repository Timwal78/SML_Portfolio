# Render root for sml-rwa-api

Dashboard → sml-rwa-api → Settings:

| Field | Value |
|-------|--------|
| **Repo** | `Timwal78/sml-rwa-api` |
| **Root Directory** | *(repo root)* |
| **Dockerfile** | `./Dockerfile` |
| **Health** | `/health` |

## Live proof after deploy
- `GET /health` → version **2.0.0**, `synthetic: false`
- `GET /x402/rwa-assets?limit=5` → live ids like `buidl`, `usyc` (NOT `rwa-000001`)
- `GET /x402/rwa-valuation?asset_id=buidl` → HTTP 402 + `PAYMENT-REQUIRED`
