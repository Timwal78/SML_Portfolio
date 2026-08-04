# API Marketplace Listings — REAL PACK (generated 2026-07-29)

**Source of truth (live):** [https://mcp-x402.onrender.com/openapi.json](https://mcp-x402.onrender.com/openapi.json) · **77 paths**

**Vendor:** Script Master Labs, LLC  
**SAM.gov UEI:** `G24VZA4RLMK3` · **CAGE:** `21U51` · **SDVOSB**  
**x402 payTo:** `0x72330994f379a71542e7bd5a4cf99a9d9743f4aa` · **chain:** `eip155:8453` · **floor:** `$0.001 USDC`

## Files (this folder + /downloads/api-marketplace/)

| File | Purpose |
|------|---------|
| openapi.json | Live OpenAPI + SAM stamps |
| postman_collection.json | Postman v2.1 import |
| rapidapi-manifest.json | RapidAPI publisher payload |
| aws-marketplace-api-listing.json | AWS SaaS seat $599 meta |
| gcp-api-hub-listing.json | GCP API Hub |
| public-apis-manifest.json | public-apis style row |
| apis-guru-manifest.json | APIs.guru pointer |
| zyla-noncrypto-manifest.json | Zyla non-crypto only |
| api-market-manifest.json | API.market |
| client-sdk.ts / client_sdk.py | SDK clients |
| index.html | Swagger UI |
| publish_api_listings.js | **Real** on-disk validator |

## Validate

```bash
node docs/listings/marketplace/publish_api_listings.js
```

## Portal steps (human where required)

1. **Postman Public Network** — Import `postman_collection.json` → Publish
2. **RapidAPI** — New API → OpenAPI upload `openapi.json` → pricing from rapidapi-manifest
3. **AWS Marketplace** — use aws-marketplace-api-listing.json (seat **$599/mo · 150+**); seller console human
4. **GCP API Hub** — register openapi URL
5. **public-apis** — PR row from public-apis-manifest.json
6. **Zyla** — non-crypto endpoints only (zyla-noncrypto-manifest.json)
7. **Swagger** — live at https://www.scriptmasterlabs.com/api-docs.html (after deploy)

## Agent / MCP

- MCP SSE: `https://mcp-x402.onrender.com/mcp`
- Catalog: `https://mcp-x402.onrender.com/.well-known/x402`
- Smithery / mcp.so / Glama — point at MCP URL + OpenAPI

## Dual GTM (frozen)

- Enterprise seat: **$599/mo · 150+ APIs** (AWS)
- Agent snacks: **$0.001 USDC** Base x402
