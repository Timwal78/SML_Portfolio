# SML RWA Intelligence Suite API

Live Real-World Asset oracle for autonomous agents.

**No synthetic catalog.** Curated registry IDs + live DefiLlama TVL + CoinGecko markets + recomputable SHA-256 source-integrity proofs.

Host: `https://sml-rwa-api.onrender.com`

## Data truth

| Layer | Source |
|-------|--------|
| Asset IDs / classes / issuers | ScriptMasterLabs curated registry (`rwa_engine.py`) |
| AUM / TVL | DefiLlama `/protocols` + `/protocol/{slug}` history |
| Token price / mcap / volume | CoinGecko simple/price + market_chart |
| Proof hash | SHA-256 over canonical live snapshot (recomputable) |

Not a custodian legal PoR letter. Not investment advice. Not demo rows.

## Endpoints

### Free
- `GET /x402/rwa-assets` — live universe scan  
  Query: `limit`, `asset_class`, `chain`, `q`, `min_tvl_usd`, `max_risk`, `constraint`

### Premium (x402 USDC Base, header `X-PAYMENT`)
- `GET /x402/rwa-valuation?asset_id=buidl&days=30` — **0.15 USDC**
- `GET /x402/proof-of-reserves?asset_id=buidl` — **0.20 USDC**
- `GET /x402/rwa-intelligence?action=valuation&asset_id=buidl` — **0.20 USDC**
- `GET /x402/rwa-aggregates` — **0.25 USDC**
- `GET /x402/rwa-risk?asset_id=buidl` — **0.10 USDC**

### Discovery
- `GET /health`
- `GET /.well-known/x402` — OpenAPI 3.1 + x-payment-info

## Example IDs
`buidl`, `usyc`, `ousg`, `ondo`, `paxg`, `xaut`, `maple`, `centrifuge`, `spiko`, …

## ACP wedge
Search **scriptmasterlabs** → hire **rwa_intelligence** @ **$0.03**  
Penny path: **gas_tracker** @ **$0.01**

## SqueezeOS MCP
- `rwa_scan` → free assets
- `rwa_valuation` / `rwa_proof_of_reserves` / `rwa_intelligence` → this host (pass `x_payment` after settle)

## Deploy
Render Docker web service, root = repo root, health `/health`, autoDeploy from `main`.
