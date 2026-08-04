# Swarm Market Making — OpenAPI route map (generated companion)

Base URL: configured at deploy (default http://127.0.0.1:8088)
Interactive: GET /docs
Machine: GET /openapi.json

## Free (Variant D + discovery)

| Method | Path | Notes |
|--------|------|-------|
| GET | / | Product map |
| GET | /health | Liveness |
| GET | /v1/engine | Quote mode + state |
| GET | /.well-known/x402 | Payment catalog |
| GET | /mcp/tools | MCP manifest |
| POST | /mcp/call | Tool dispatch |
| POST | /v1/sim/join | Paper join |
| POST | /v1/sim/trade | Paper limit |
| GET | /v1/sim/account/{user_id} | Paper account |
| GET | /v1/sim/leaderboard | Rankings |
| POST | /v1/sim/upgrade | A/B/C funnel |
| POST | /v1/b2b/configure | Tenant setup |
| POST | /v1/crypto/deposit | Geofenced |
| POST | /v1/crypto/withdraw | Geofenced |
| POST | /v1/crypto/rebalance | Geofenced |
| GET | /v1/pricing | Price card |

## Paid (x402 or X-Operator-Key)

| Method | Path | USD |
|--------|------|-----|
| GET | /v1/signal/levels | 0.001 |
| GET | /v1/signal/venue-map | 0.001 |
| GET | /v1/signal/rebate-tracker | 0.001 |
| POST | /v1/signal/subscribe | 19.00 |
| POST | /v1/sim/premium | 9.00 |
| POST | /v1/b2b/optimize | 0.05 |
| GET | /v1/b2b/report | 0.10 |
| GET | /v1/crypto/positions | 0.001 |

payTo Base USDC: 0x72330994f379a71542e7bd5a4cf99a9d9743f4aa
