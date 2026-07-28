# ScriptMasterLabs — Master Listing Pack (Agent + Human)

**Goal:** list everywhere. Canonical source of truth = our own catalog.

## Canonical (own catalog)
| Surface | URL |
|---------|-----|
| Site | https://www.scriptmasterlabs.com |
| Marketplace | https://www.scriptmasterlabs.com/marketplace.html |
| VendOS | https://www.scriptmasterlabs.com/vendos.html |
| Watch agent pay | https://www.scriptmasterlabs.com/watch-the-agent-pay.html |
| OpenAPI / x402 | https://mcp-x402.onrender.com/.well-known/x402 |
| OpenAPI alias | https://mcp-x402.onrender.com/openapi.json |
| A2A agent card | https://mcp-x402.onrender.com/.well-known/agent.json |
| agents.json | https://mcp-x402.onrender.com/agents.json |
| llms.txt (mcp) | https://mcp-x402.onrender.com/llms.txt |
| llms.txt (www) | https://www.scriptmasterlabs.com/llms.txt |
| Remote MCP | https://mcp-x402.onrender.com/mcp |
| SqueezeOS MCP | https://squeezeos-api.onrender.com/mcp |
| RWA API | https://sml-rwa-api.onrender.com |
| Health | https://mcp-x402.onrender.com/health |
| Rails payTo | `0x4e14B249D9A4c9c9352D780eCEB508A8eB7a7700` |
| Network | `eip155:8453` Base mainnet USDC only |
| Price floor | **0.001 USDC** per call |
| AWS seat | **$599/mo · 151+ APIs** (resubmitted) |

## Catalog stats
- OpenAPI paths: **77**
- Paid x402 routes: **71**
- Tags: **66**

## Highlight snacks (list these first on every hub)
- `High-freq crypto price` → `https://mcp-x402.onrender.com/x402/crypto-price` · 0.001 USDC
- `Trending coins` → `https://mcp-x402.onrender.com/x402/crypto-trending` · 0.001 USDC
- `FX rates` → `https://mcp-x402.onrender.com/x402/fx-rate` · 0.001 USDC
- `Multi-chain gas` → `https://mcp-x402.onrender.com/x402/gas-tracker` · 0.001 USDC
- `URL fetch for agents` → `https://mcp-x402.onrender.com/x402/web-fetch` · 0.001 USDC
- `News headlines` → `https://mcp-x402.onrender.com/x402/news-headlines` · 0.001 USDC
- `Federal grants.gov` → `https://mcp-x402.onrender.com/x402/grants` · 0.001 USDC
- `SEC 8-K filings` → `https://mcp-x402.onrender.com/x402/sec-8k` · 0.001 USDC
- `FRED economic data` → `https://mcp-x402.onrender.com/x402/fred` · 0.001 USDC
- `Section 8 PHA lookup` → `https://mcp-x402.onrender.com/x402/pha-lookup` · 0.001 USDC
- `HUD FMR / HCV` → `https://mcp-x402.onrender.com/x402/hcv-fmr` · 0.001 USDC
- `Section 8 landlord checklist` → `https://mcp-x402.onrender.com/x402/housing-landlord-checklist` · 0.001 USDC
- `SAM entity compliance` → `https://mcp-x402.onrender.com/x402/entity-compliance` · 0.001 USDC
- `Treasury yields` → `https://mcp-x402.onrender.com/x402/treasury-yields` · 0.001 USDC
- `Cascade Accumulator` → `https://mcp-x402.onrender.com/x402/cascade-signal` · 0.001 USDC
- RWA → `https://sml-rwa-api.onrender.com` · 0.001 USDC

## Full paid route table
| Method | Path | Price | Summary |
|--------|------|-------|---------|
| GET | `/x402/agent-score` | 0.001 | AI agent FICO-style reputation score (300–850). |
| GET | `/x402/base-rpc` | 0.001 | Base mainnet JSON-RPC read helper. |
| POST | `/x402/bounties` | 0.01 | Post a reverse bounty (paid listing fee). |
| POST | `/x402/cascade-signal` | 0.001 | CASCADE ACCUMULATOR directive — ACCUMULATE/PYRAMID/EXIT/STOP. |
| POST | `/x402/chat/completions` | 0.001 | OpenAI-compatible POST chat completions proxy. |
| GET | `/x402/clinical-trials` | 0.001 | Clinical trial search (ClinicalTrials.gov APIv2). |
| GET | `/x402/cms-providers` | 0.001 | CMS Medicare hospital quality data and physician provider information. |
| POST | `/x402/compliance-anomaly` | 0.001 | Submit a bank compliance anomaly for scoring. |
| POST | `/x402/compliance-audit` | 0.001 | Full Leviathan Matrix compliance audit cycle for a bank. |
| GET | `/x402/compliance-regulator-query` | 0.001 | Real-time regulator compliance dashboard query for a bank. |
| GET | `/x402/congress-bills` | 0.001 | Congress.gov bill search — legislation by keyword and congress number. |
| POST | `/x402/content-trust-score` | 0.001 | Content misinformation trust scoring plus on-chain wallet trust ledger. |
| GET | `/x402/crypto-price` | 0.001 | Real-time token price, market cap, and 24h volume/change. |
| GET | `/x402/crypto-trending` | 0.001 | Top trending coins, NFTs, and categories in the last 24h. |
| GET | `/x402/domain-enrich` | 0.001 | Domain enrichment: DNS + RDAP + geo. |
| GET | `/x402/drug-adverse-events` | 0.001 | FDA adverse event reports (openFDA FAERS). |
| GET | `/x402/drug-label` | 0.001 | FDA drug label lookup (openFDA). |
| GET | `/x402/drug-recall` | 0.001 | FDA drug recall/enforcement search (openFDA). |
| GET | `/x402/entity-compliance` | 0.001 | SAM entity compliance bundle: registration + exclusion + set-asides + NAICS. |
| GET | `/x402/epa-violations` | 0.001 | EPA ECHO environmental enforcement and violation records. |
| GET | `/x402/equities-heatmap` | 0.001 | Equities RSI(14) heatmap across up to 20 tickers, with a real 4-agent Claude swa |
| GET | `/x402/eth-rpc` | 0.001 | Ethereum JSON-RPC read helper. |
| GET | `/x402/fact-check` | 0.001 | Grounding oracle: fact-checks a claim against live government/FDA/SEC/Treasury d |
| GET | `/x402/fda-510k` | 0.001 | FDA 510(k) medical device premarket clearances (openFDA). |
| GET | `/x402/fda-warnings` | 0.001 | FDA warning letters — regulatory enforcement actions. |
| GET | `/x402/fec-finance` | 0.001 | FEC campaign finance — candidates, committees, and contribution totals. |
| GET | `/x402/finra-broker` | 0.001 | FINRA BrokerCheck broker/advisor registration and disclosure history. |
| GET | `/x402/firms` | 0.001 | Find self-certified SDVOSB/WOSB/SDB/minority firms by NAICS + state (SAM.gov). |
| GET | `/x402/fred` | 0.001 | FRED economic indicator series (Federal Reserve Bank of St. Louis). |
| GET | `/x402/ftd-etf-basket` | 0.001 | ETF constituents ranked by FTD notional concentration. |
| GET | `/x402/ftd-ratio` | 0.001 | Latest FTD ratio and percentile rank for a symbol. |
| GET | `/x402/ftd-settlement-cycle` | 0.001 | Settlement-cycle bundle — FTD stats, T+21/T+35 markers, Reg SHO 204 marker. |
| GET | `/x402/ftd-threshold-list` | 0.001 | SEC Reg SHO Threshold Securities List — persistent fails-to-deliver names. |
| GET | `/x402/ftd-time-series` | 0.001 | Historical SEC Reg SHO fails-to-deliver time series for a symbol. |
| GET | `/x402/fx-rate` | 0.001 | Latest or historical exchange rate for a base currency. |
| GET | `/x402/gas-tracker` | 0.001 | Multi-chain gas tracker snack. |
| GET | `/x402/grants` | 0.001 | Search live U.S. federal grant opportunities (Grants.gov Search2). |
| GET | `/x402/graph` | 0.001 | EchoNet usage graph query (paid). |
| GET | `/x402/graph/agent` | 0.001 | EchoNet agent reputation profile (paid). |
| GET | `/x402/hcv-fmr` | 0.001 | HUD Fair Market Rent + estimated payment-standard band. |
| GET | `/x402/housing-landlord-checklist` | 0.001 | Section 8 / HCV landlord checklist + HQS hotspots. |
| GET | `/x402/housing-windsor` | 0.001 | Kinston 4BR landlord bundle (PHA + FMR + call script + income worksheet). |
| GET | `/x402/hud-vash-contacts` | 0.001 | HUD-VASH veteran housing contact guidance. |
| POST | `/x402/hunters/report` | 0.001 | Publish hunter report (paid). |
| GET | `/x402/iam-model` | 0.001 | Inevitable Action Model — obligation committee verdict and mandatory action. |
| GET | `/x402/insider-trades` | 0.001 | SEC EDGAR Form 4 insider trades by ticker. |
| GET | `/x402/llm-chat` | 0.001 | Cheap LLM chat completion proxy for agents. |
| GET | `/x402/lobbying` | 0.001 | Senate LDA lobbying disclosure filings — client, registrant, issues, and amounts |
| GET | `/x402/market` | 0.001 | Federal contract market intelligence by NAICS (USAspending). |
| POST | `/x402/max-conviction-signal` | 0.001 | TRIPLE_LOCK_VERDICT — max-conviction rare signal, distinct from the standard squ |
| GET | `/x402/news-headlines` | 0.001 | Google News RSS headlines. |
| GET | `/x402/nih-grants` | 0.001 | NIH Reporter research grant database. |
| GET | `/x402/npi` | 0.001 | NPPES provider (NPI) lookup. |
| GET | `/x402/options-delta-heatmap` | 0.001 | Options Delta heatmap across up to 40 contracts, with a real 4-agent Claude swar |
| GET | `/x402/options-flow` | 0.001 | Institutional options flow — sweeps, whale detection, dark-pool prints. |
| GET | `/x402/osha` | 0.001 | OSHA workplace inspection and violation records (DOL enforcement data). |
| GET | `/x402/patents` | 0.001 | USPTO PatentsView patent search — title, abstract, assignee, CPC class, grant da |
| GET | `/x402/pha-lookup` | 0.001 | Public Housing Authority (PHA) lookup by ZIP/city/county. |
| GET | `/x402/restricted-party-screen` | 0.001 | Screen a name against all 11 US export-control and sanctions lists. |
| GET | `/x402/sbir-grants` | 0.001 | SBIR/STTR small business innovation research grants. |
| GET | `/x402/sec-10k` | 0.001 | SEC EDGAR 10-K annual report filings by ticker. |
| GET | `/x402/sec-10q` | 0.001 | SEC EDGAR 10-Q quarterly report filings by ticker. |
| GET | `/x402/sec-13dg` | 0.001 | SEC EDGAR 13D/13G activist investor filings by ticker. |
| GET | `/x402/sec-13f` | 0.001 | SEC EDGAR 13F institutional holdings — hedge fund quarterly positions. |
| GET | `/x402/sec-8k` | 0.001 | SEC EDGAR 8-K material event filings by ticker. |
| GET | `/x402/social-search` | 0.001 | Public web social pulse search (not official X API). |
| GET | `/x402/trade-leads` | 0.001 | Search live overseas trade leads for US exporters. |
| GET | `/x402/treasury-yields` | 0.001 | Daily US Treasury yield curve rates (1M–30Y). |
| GET | `/x402/web-fetch` | 0.001 | Fetch a public URL and return text/json for agents. |
| GET | `/x402/web-markdown` | 0.001 | URL to simplified markdown/text. |
| GET | `/x402/web-search` | 0.001 | Keyless web search for agents. |

## PASTE-READY: Smithery
```
Name: Timwal78/mcp-x402
Server URL: https://mcp-x402.onrender.com/mcp
```
```
Name: Timwal78/SqueezeOS
Server URL: https://squeezeos-api.onrender.com/mcp
```

## PASTE-READY: MCP directories (mcp.so / Glama / PulseMCP / Official registry)
```
Title: ScriptMasterLabs mcp-x402
Description: 70+ pay-per-call APIs for AI agents. Federal, SEC, Section 8/HUD, crypto, FX, gas, news, RWA. x402 USDC on Base. No API keys.
MCP URL: https://mcp-x402.onrender.com/mcp
Homepage: https://www.scriptmasterlabs.com
OpenAPI: https://mcp-x402.onrender.com/openapi.json
llms.txt: https://mcp-x402.onrender.com/llms.txt
License: MIT
Tags: mcp, x402, usdc, base, federal, section-8, rwa, crypto, agents
```

## PASTE-READY: Anthropic / Claude MCP config
```json
{
  "mcpServers": {
    "scriptmasterlabs": {
      "url": "https://mcp-x402.onrender.com/mcp",
      "transport": "streamable-http"
    }
  }
}
```

## PASTE-READY: Cursor / OpenAI-compatible MCP
```json
{
  "mcpServers": {
    "sml": {
      "url": "https://mcp-x402.onrender.com/mcp"
    }
  }
}
```

## PASTE-READY: RapidAPI / APILayer / Zyla / API.market (one product, many endpoints)
```
API Name: ScriptMasterLabs Federal RWA Finance Data API
Category: Data / Finance / Government / AI Agents
Base URL: https://mcp-x402.onrender.com
Auth: None required for discovery; payment via HTTP 402 x402 (USDC Base) OR optional enterprise key
Pricing: $0.001 USDC/call agents · AWS Marketplace company seat $599/mo (151+ endpoints)
OpenAPI: https://mcp-x402.onrender.com/openapi.json
Docs: https://www.scriptmasterlabs.com
Support: ScriptMasterLabs@gmail.com
SDVOSB: UEI G24VZA4RLMK3 · CAGE 21U51
```

## PASTE-READY: Cloudflare Workers AI Gateway / Vercel AI SDK
```
Provider baseURL: https://mcp-x402.onrender.com
Chat: POST /x402/chat/completions (402 pay-per-call)
Tools OpenAPI: https://mcp-x402.onrender.com/openapi.json
Payment: x402 X-PAYMENT header after 402 challenge
```

## PASTE-READY: Hugging Face
```
Repo type: Dataset or Space card
Title: ScriptMasterLabs x402 Agent API Catalog
OpenAPI: https://mcp-x402.onrender.com/openapi.json
MCP: https://mcp-x402.onrender.com/mcp
Tags: x402, mcp, agents, usdc, federal-data, rwa
```

## PASTE-READY: Composio / Pipedream / Zapier AI / Lindy / Relevance
```
Action pack name: ScriptMasterLabs Data
Auth: HTTP 402 x402 micropayment (USDC Base) — or bearer for enterprise seat
Base: https://mcp-x402.onrender.com
Import OpenAPI: https://mcp-x402.onrender.com/openapi.json
Sample actions: gas_tracker, crypto_price, fx_rate, grants, pha_lookup, sec_8k, fred
```

## PASTE-READY: Kong / Apigee / Azure APIM / AWS API Gateway (enterprise wrapper)
```
Upstream: https://mcp-x402.onrender.com
Spec: https://mcp-x402.onrender.com/openapi.json
Rate limit: customer-defined
Monetization: pass-through x402 OR company seat $599/mo via AWS Marketplace
Health: GET /health
```

## PASTE-READY: GitHub Topics + README badges
```
topics: mcp, x402, usdc, base, ai-agents, federal-data, section-8, rwa, openapi, pay-per-call
npm: @scriptmasterlabs/mcp-x402
sdk: @scriptmasterlabs/mcp-x402-sdk
```

## npm already live
- https://www.npmjs.com/package/@scriptmasterlabs/mcp-x402
- https://www.npmjs.com/package/@scriptmasterlabs/mcp-x402-sdk

## x402scan / CDP
- Server: https://www.x402scan.com (add OpenAPI URL)
- OpenAPI: https://mcp-x402.onrender.com/.well-known/x402
- Recipient rails: https://www.x402scan.com/recipient/0x4e14B249D9A4c9c9352D780eCEB508A8eB7a7700

## Human-only portals (1-click forms — paste blocks above)
- Smithery (needs API key once): https://smithery.ai
- mcp.so · glama.ai · pulsemcp.com
- RapidAPI · Zyla · APILayer · API.market
- Composio · Pipedream · Zapier · Lindy · Relevance AI
- Hugging Face Spaces
- AWS Marketplace (already resubmitted $599/151)

Generated for dual GTM: agents @ 0.001 USDC + enterprise seat $599.
