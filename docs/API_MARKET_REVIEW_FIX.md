# {API}Market review fix (2026-08-02)

## Reviewer blockers
1. Playground returned HTTP 402
2. OpenAPI must not require X-Coingecko-Key / X-Sam-Key / X-Openfda-Key

## Fix shipped
### Free playground (no payment)
- GET https://mcp-x402.onrender.com/x402/playground
- GET https://mcp-x402.onrender.com/x402/playground/demo
- GET https://mcp-x402.onrender.com/x402/playground/grants?keyword=veteran
- GET https://mcp-x402.onrender.com/x402/playground/fred?series_id=GDP

### Paid routes marketplace auth
Set seller dashboard secret to match Render `API_MARKET_PROXY_SECRET`.
Gateway should send one of:
- `X-Api-Market-Key: <secret>`
- `X-API-Key: <secret>`
- `Authorization: Bearer <secret>`

### BYOK
Server uses env `SAM_API_KEY`, `OPENFDA_API_KEY`, `COINGECKO_API_KEY`, `FRED_API_KEY`.
Clients never pass those headers. Optional undocumented BYOK still works server-side but is **not** in OpenAPI.

## Paste back to reviewer
Playground free paths above return 200. OpenAPI has no third-party key params. Production auth is x402 or X-Api-Market-Key only.
