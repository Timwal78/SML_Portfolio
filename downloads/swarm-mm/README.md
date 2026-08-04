# Swarm Market Making — Script Master Labs

**4-variant swarm market-making suite. Build once, deploy four ways.**

| Variant | Name | Risk | Monetization | Status |
|---------|------|------|--------------|--------|
| **D** | Simulated Swarm | Zero | Free + $9/mo premium | **Ship first** |
| **A** | Signal Swarm | Low | $19/mo SaaS | Month 2 |
| **C** | B2B Swarm Engine | Very low | $5K/mo + 2% lift | Month 3 |
| **B** | Crypto-Only Swarm | Medium | 0.5% rebate share | Month 4 (legal) |

## Quick start

```bash
cd swarm-mm
pip install -r requirements.txt
export SWARM_MM_DEV_OPEN=1
uvicorn swarm_mm.api.app:app --host 0.0.0.0 --port 8088
```

- Health: `GET /health`
- OpenAPI: `GET /docs`
- x402 catalog: `GET /.well-known/x402`
- MCP tools: `GET /mcp/tools`

## Variant D — paper swarm (launch path)

```bash
curl -s -X POST localhost:8088/v1/sim/join \
  -H 'content-type: application/json' \
  -d '{"user_id":"alpha","starting_balance":100000}'

curl -s -X POST localhost:8088/mcp/call \
  -H 'content-type: application/json' \
  -d '{"tool":"sim_swarm.trade","params":{"user_id":"alpha","ticker":"SPY","side":"buy","price":9999,"size":5}}'

curl -s localhost:8088/v1/sim/leaderboard
```

## Variant A — signals only (no custody)

User places orders at **their** broker. Swarm never holds capital.

- `GET /v1/signal/levels?ticker=SPY&side=both&confidence_threshold=0.75`
- `GET /v1/signal/venue-map?ticker=SPY`
- `GET /v1/signal/rebate-tracker?user_id=u1&ticker=SPY`

x402: **$0.001/call** hot path, **$19/mo** subscription.  
payTo (Base USDC): `0x72330994f379a71542e7bd5a4cf99a9d9743f4aa`

## Variant C — B2B white-label

Customer is the licensed BD. You are software vendor.

- `POST /v1/b2b/configure`
- `POST /v1/b2b/optimize` `{ "customer_id", "target": "rebate_capture"|"spread" }`
- `GET /v1/b2b/report?customer_id=...`

## Variant B — crypto scaffold (US geofenced)

Requires `non_us_attestation=true` on deposit/withdraw/rebalance.  
MVP is **off-chain accounting scaffold** — audited vault contracts are a separate deliverable.

## MCP tools

| Tool | Variant | Price |
|------|---------|-------|
| `sim_swarm.join/trade/leaderboard/upgrade` | D | free |
| `signal_swarm.levels/venue_map/rebate_tracker` | A | $0.001 |
| `b2b_swarm.configure/optimize/report` | C | 0 / $0.05 / $0.10 |
| `crypto_swarm.deposit/positions/withdraw/rebalance` | B | geofenced |

```bash
curl -s -X POST localhost:8088/mcp/call \
  -H 'content-type: application/json' \
  -d '{"tool":"signal_swarm.levels","params":{"ticker":"QQQ","side":"both"}}'
```

## Payments

- Base USDC `eip155:8453` → `SML_PAYMENT_RECEIVER` (default SML EOA above)
- Operator bypass: header `X-Operator-Key: $SML_API_KEY` (server-side only)
- Dev: `SWARM_MM_DEV_OPEN=1` allows free calls when no `SML_API_KEY` set
- Soft x402: send `X-PAYMENT` / `X-Payment-Hash` proof header (strict chain verify optional)

## Architecture

```
swarm_mm/
  core/          shared ladder engine, quotes, state
  variants/
    d_sim/       paper accounts, fills, leaderboard, upgrade
    a_signal/    levels, venue map, rebate, subscribe, broker adapters
    c_b2b/       multi-tenant configure/optimize/report
    b_crypto/    geofenced vault scaffold
  billing/x402.py
  api/app.py     FastAPI
  api/ws.py      WebSocket signal broadcast (/ws/signals)
  mcp/tools.py   MCP catalog + dispatch
  static/        product landing (/landing)
```

Stack: Python coordination, optional Redis, x402 Base USDC, WebSocket broadcast, broker order **preview** adapters (Alpaca/Tradier/IBKR — user submits).

## WebSocket

```bash
# connect then:
# {"op":"subscribe","ticker":"SPY"}
# {"op":"ping"}
# {"op":"leaderboard"}
```

Path: `/ws/signals`

## Broker previews (Variant A)

```bash
curl -s 'localhost:8088/v1/signal/broker-orders?ticker=SPY&broker=alpaca&confidence_threshold=0.7'
```

Returns broker-native limit payloads with `"submit": false`. Swarm never places the order.

## Deploy

```bash
# local
cp .env.example .env
uvicorn swarm_mm.api.app:app --host 0.0.0.0 --port 8088

# Render
# render.yaml included — attach custom www domain only (never *.onrender for GSC)
```

## Regulatory posture (product design)

- **A**: research/signal provider — user broker executes; no PFOF; no pooled capital
- **B**: crypto software + geofence; legal review before mainnet vault
- **C**: pure software vendor; customer indemnifies + holds licenses
- **D**: simulation/education — not a securities offering

Standard disclaimers on every response. Not investment advice. Not a BD/ATS/RIA.

## Tests

```bash
pytest -q
```

## Owner

Script Master Labs — SDVOSB  
Product: Swarm Market Making  
Rails: x402-native, multi-chain ready, AP2/agent identity compatible
