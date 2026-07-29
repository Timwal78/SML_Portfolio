# SML Platform API Inventory — 2026-07-29

Live-sourced from mcp-x402 OpenAPI + squeezeos-api OpenAPI + MCP banner/tools.

## Seat scoreboard (AWS $599 target = 151)

| Metric | Count |
|--------|------:|
| **AWS seat countable (now)** | **176** |
| AWS seat target | 151 |
| **Gap** | **0** |
| mcp-x402 OpenAPI paths | 77 |
| mcp-x402 seat-countable | 73 |
| squeezeos-api OpenAPI paths | 43 |
| squeezeos MCP tools (named/export) | 62 |
| squeezeos seat-countable | 103 |
| Zyla-eligible mcp-x402 (non-crypto product) | 68 |

## By platform

| Platform | HTTP paths | MCP | Seat units |
|----------|----------:|----:|-----------:|
| mcp-x402 | 77 | 0 | 73 |
| squeezeos-api | 43 | 62 | 103 |

## By bucket (seat units)

| Bucket | Seat units |
|--------|----------:|
| crypto | 39 |
| trading_exec | 30 |
| ftd_equities | 26 |
| federal_contracts | 19 |
| agent_hf | 17 |
| fda_health | 8 |
| compliance | 8 |
| sec_filings | 7 |
| other | 6 |
| housing_hud | 5 |
| gov_politics | 3 |
| macro_fx | 3 |
| rwa | 3 |
| infra | 2 |

## How to read this

- **HTTP OpenAPI path** = 1 seat unit (infra excluded).
- **Named MCP tool** = 1 seat unit.
- **mcp-x402 ~75 product routes** matches the “~72” gut check.
- **squeezeos OpenAPI = 43**, not 88; **MCP advertises 62 tools** — together people round to ~88–100.
- **151** is the AWS packaging target; this file is the honest ledger.

## Close the gap to 151

- Current countable seat units: 176 / 151 (gap 0).
- Count rules: infra excluded; each HTTP product path = 1; each named MCP tool = 1; if tools/list blocked, advertised tools_count counted as bundle weight.
- To close gap: (1) export full SqueezeOS MCP tools/list into inventory, (2) promote shadow routes into OpenAPI, (3) add missing federal/macro/agent snacks on mcp-x402, (4) avoid double-counting same capability on two hosts in buyer-facing 151 claim — or explicitly market as multi-host platform seat.
- AWS $599 seat should cite this inventory file + live OpenAPI URLs, not a vibes number.

## Full endpoint list

| Platform | Kind | Path / Tool | Methods | Bucket | Seat |
|----------|------|-------------|---------|--------|-----:|
| mcp-x402 | http_openapi | `/x402/agent-score` | GET | trading_exec | 1 |
| mcp-x402 | http_openapi | `/x402/base-rpc` | GET | crypto | 1 |
| mcp-x402 | http_openapi | `/x402/bounties` | GET,POST | agent_hf | 1 |
| mcp-x402 | http_openapi | `/x402/cascade-signal` | POST | ftd_equities | 1 |
| mcp-x402 | http_openapi | `/x402/chat/completions` | POST | agent_hf | 1 |
| mcp-x402 | http_openapi | `/x402/clinical-trials` | GET | fda_health | 1 |
| mcp-x402 | http_openapi | `/x402/cms-providers` | GET | fda_health | 1 |
| mcp-x402 | http_openapi | `/x402/compliance-anomaly` | POST | compliance | 1 |
| mcp-x402 | http_openapi | `/x402/compliance-audit` | POST | compliance | 1 |
| mcp-x402 | http_openapi | `/x402/compliance-regulator-query` | GET | compliance | 1 |
| mcp-x402 | http_openapi | `/x402/congress-bills` | GET | gov_politics | 1 |
| mcp-x402 | http_openapi | `/x402/content-trust-score` | POST | agent_hf | 1 |
| mcp-x402 | http_openapi | `/x402/crypto-price` | GET | crypto | 1 |
| mcp-x402 | http_openapi | `/x402/crypto-trending` | GET | crypto | 1 |
| mcp-x402 | http_openapi | `/x402/domain-enrich` | GET | agent_hf | 1 |
| mcp-x402 | http_openapi | `/x402/drug-adverse-events` | GET | fda_health | 1 |
| mcp-x402 | http_openapi | `/x402/drug-label` | GET | fda_health | 1 |
| mcp-x402 | http_openapi | `/x402/drug-recall` | GET | fda_health | 1 |
| mcp-x402 | http_openapi | `/x402/echonet` | GET | agent_hf | 1 |
| mcp-x402 | http_openapi | `/x402/entity-compliance` | GET | federal_contracts | 1 |
| mcp-x402 | http_openapi | `/x402/epa-violations` | GET | compliance | 1 |
| mcp-x402 | http_openapi | `/x402/equities-heatmap` | GET | ftd_equities | 1 |
| mcp-x402 | http_openapi | `/x402/eth-rpc` | GET | crypto | 1 |
| mcp-x402 | http_openapi | `/x402/fact-check` | GET | compliance | 1 |
| mcp-x402 | http_openapi | `/x402/fda-510k` | GET | fda_health | 1 |
| mcp-x402 | http_openapi | `/x402/fda-warnings` | GET | fda_health | 1 |
| mcp-x402 | http_openapi | `/x402/fec-finance` | GET | gov_politics | 1 |
| mcp-x402 | http_openapi | `/x402/finra-broker` | GET | compliance | 1 |
| mcp-x402 | http_openapi | `/x402/firms` | GET | federal_contracts | 1 |
| mcp-x402 | http_openapi | `/x402/fred` | GET | macro_fx | 1 |
| mcp-x402 | http_openapi | `/x402/ftd-etf-basket` | GET | ftd_equities | 1 |
| mcp-x402 | http_openapi | `/x402/ftd-ratio` | GET | ftd_equities | 1 |
| mcp-x402 | http_openapi | `/x402/ftd-settlement-cycle` | GET | ftd_equities | 1 |
| mcp-x402 | http_openapi | `/x402/ftd-threshold-list` | GET | ftd_equities | 1 |
| mcp-x402 | http_openapi | `/x402/ftd-time-series` | GET | ftd_equities | 1 |
| mcp-x402 | http_openapi | `/x402/fx-rate` | GET | macro_fx | 1 |
| mcp-x402 | http_openapi | `/x402/gas-tracker` | GET | crypto | 1 |
| mcp-x402 | http_openapi | `/x402/grants` | GET | federal_contracts | 1 |
| mcp-x402 | http_openapi | `/x402/graph` | GET | agent_hf | 1 |
| mcp-x402 | http_openapi | `/x402/graph/agent` | GET | trading_exec | 1 |
| mcp-x402 | http_openapi | `/x402/hcv-fmr` | GET | housing_hud | 1 |
| mcp-x402 | http_openapi | `/x402/housing-landlord-checklist` | GET | housing_hud | 1 |
| mcp-x402 | http_openapi | `/x402/housing-windsor` | GET | housing_hud | 1 |
| mcp-x402 | http_openapi | `/x402/hud-vash-contacts` | GET | housing_hud | 1 |
| mcp-x402 | http_openapi | `/x402/hunters` | GET | agent_hf | 1 |
| mcp-x402 | http_openapi | `/x402/hunters/report` | POST | agent_hf | 1 |
| mcp-x402 | http_openapi | `/x402/iam-model` | GET | ftd_equities | 1 |
| mcp-x402 | http_openapi | `/x402/insider-trades` | GET | sec_filings | 1 |
| mcp-x402 | http_openapi | `/x402/llm-chat` | GET | agent_hf | 1 |
| mcp-x402 | http_openapi | `/x402/lobbying` | GET | gov_politics | 1 |
| mcp-x402 | http_openapi | `/x402/market` | GET | federal_contracts | 1 |
| mcp-x402 | http_openapi | `/x402/max-conviction-signal` | POST | ftd_equities | 1 |
| mcp-x402 | http_openapi | `/x402/news-headlines` | GET | agent_hf | 1 |
| mcp-x402 | http_openapi | `/x402/nih-grants` | GET | federal_contracts | 1 |
| mcp-x402 | http_openapi | `/x402/npi` | GET | fda_health | 1 |
| mcp-x402 | http_openapi | `/x402/options-delta-heatmap` | GET | ftd_equities | 1 |
| mcp-x402 | http_openapi | `/x402/options-flow` | GET | ftd_equities | 1 |
| mcp-x402 | http_openapi | `/x402/osha` | GET | compliance | 1 |
| mcp-x402 | http_openapi | `/x402/patents` | GET | agent_hf | 1 |
| mcp-x402 | http_openapi | `/x402/pha-lookup` | GET | housing_hud | 1 |
| mcp-x402 | http_openapi | `/x402/restricted-party-screen` | GET | federal_contracts | 1 |
| mcp-x402 | http_openapi | `/x402/sbir-grants` | GET | federal_contracts | 1 |
| mcp-x402 | http_openapi | `/x402/sec-10k` | GET | sec_filings | 1 |
| mcp-x402 | http_openapi | `/x402/sec-10q` | GET | sec_filings | 1 |
| mcp-x402 | http_openapi | `/x402/sec-13dg` | GET | sec_filings | 1 |
| mcp-x402 | http_openapi | `/x402/sec-13f` | GET | sec_filings | 1 |
| mcp-x402 | http_openapi | `/x402/sec-8k` | GET | sec_filings | 1 |
| mcp-x402 | http_openapi | `/x402/social-search` | GET | agent_hf | 1 |
| mcp-x402 | http_openapi | `/x402/trade-leads` | GET | federal_contracts | 1 |
| mcp-x402 | http_openapi | `/x402/treasury-yields` | GET | macro_fx | 1 |
| mcp-x402 | http_openapi | `/x402/web-fetch` | GET | agent_hf | 1 |
| mcp-x402 | http_openapi | `/x402/web-markdown` | GET | agent_hf | 1 |
| mcp-x402 | http_openapi | `/x402/web-search` | GET | agent_hf | 1 |
| squeezeos-api | http_openapi | `/api/council` | POST | trading_exec | 1 |
| squeezeos-api | http_openapi | `/api/demo` | GET | agent_hf | 1 |
| squeezeos-api | http_openapi | `/api/futures` | GET | trading_exec | 1 |
| squeezeos-api | http_openapi | `/api/futures/create` | POST | trading_exec | 1 |
| squeezeos-api | http_openapi | `/api/futures/leaderboard` | GET | trading_exec | 1 |
| squeezeos-api | http_openapi | `/api/futures/settle/{future_id}` | POST | trading_exec | 1 |
| squeezeos-api | http_openapi | `/api/futures/take/{future_id}` | POST | trading_exec | 1 |
| squeezeos-api | http_openapi | `/api/futures/wallet/{wallet}` | GET | crypto | 1 |
| squeezeos-api | http_openapi | `/api/ghost/audit` | GET | compliance | 1 |
| squeezeos-api | http_openapi | `/api/hiring` | GET | federal_contracts | 1 |
| squeezeos-api | http_openapi | `/api/hiring/post` | POST | federal_contracts | 1 |
| squeezeos-api | http_openapi | `/api/history/{symbol}` | GET | ftd_equities | 1 |
| squeezeos-api | http_openapi | `/api/iam/stress-test` | POST | ftd_equities | 1 |
| squeezeos-api | http_openapi | `/api/iam/truth/{symbol}` | GET | ftd_equities | 1 |
| squeezeos-api | http_openapi | `/api/iam/{symbol}` | GET | ftd_equities | 1 |
| squeezeos-api | http_openapi | `/api/iwm` | GET | ftd_equities | 1 |
| squeezeos-api | http_openapi | `/api/marketplace` | GET | federal_contracts | 1 |
| squeezeos-api | http_openapi | `/api/marketplace/list` | POST | federal_contracts | 1 |
| squeezeos-api | http_openapi | `/api/marketplace/read` | POST | federal_contracts | 1 |
| squeezeos-api | http_openapi | `/api/options` | GET | ftd_equities | 1 |
| squeezeos-api | http_openapi | `/api/preview/{symbol}` | GET | ftd_equities | 1 |
| squeezeos-api | http_openapi | `/api/relay/register` | POST | trading_exec | 1 |
| squeezeos-api | http_openapi | `/api/scan` | GET | ftd_equities | 1 |
| squeezeos-api | http_openapi | `/api/settlement` | GET | trading_exec | 1 |
| squeezeos-api | http_openapi | `/api/settlement/cancel/{contract_id}` | POST | trading_exec | 1 |
| squeezeos-api | http_openapi | `/api/settlement/create` | POST | trading_exec | 1 |
| squeezeos-api | http_openapi | `/api/settlement/trigger/{contract_id}` | POST | trading_exec | 1 |
| squeezeos-api | http_openapi | `/api/settlement/wallet/{wallet}` | GET | crypto | 1 |
| squeezeos-api | http_openapi | `/api/settlement/{contract_id}` | GET | trading_exec | 1 |
| squeezeos-api | http_openapi | `/api/webhooks/subscribe` | POST,DELETE | trading_exec | 1 |
| squeezeos-api | http_openapi | `/v1/admin/agent/{wallet}/kyb` | POST | crypto | 1 |
| squeezeos-api | http_openapi | `/v1/admin/flush` | POST | other | 1 |
| squeezeos-api | http_openapi | `/v1/agent/{wallet}` | GET | crypto | 1 |
| squeezeos-api | http_openapi | `/v1/bridge/execute` | POST | trading_exec | 1 |
| squeezeos-api | http_openapi | `/v1/endpoint` | POST | trading_exec | 1 |
| squeezeos-api | http_openapi | `/v1/invoice` | POST | trading_exec | 1 |
| squeezeos-api | http_openapi | `/v1/loyalty/redeem` | POST | trading_exec | 1 |
| squeezeos-api | http_openapi | `/v1/loyalty/{wallet}` | GET | crypto | 1 |
| squeezeos-api | http_openapi | `/v1/merchant/register` | POST | trading_exec | 1 |
| squeezeos-api | http_openapi | `/v1/receipt/{id}` | GET | trading_exec | 1 |
| squeezeos-api | http_openapi | `/v1/verify` | POST | trading_exec | 1 |
| squeezeos-api | mcp_tool | `demo_council` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `council_verdict` | MCP | ftd_equities | 1 |
| squeezeos-api | mcp_tool | `market_scan` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `options_intelligence` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `iwm_odte` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `signal_preview` | MCP | ftd_equities | 1 |
| squeezeos-api | mcp_tool | `signal_history` | MCP | federal_contracts | 1 |
| squeezeos-api | mcp_tool | `get_invoice` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `verify_payment` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `bureau_public_score` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `marketplace_browse` | MCP | federal_contracts | 1 |
| squeezeos-api | mcp_tool | `marketplace_read_signal` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `marketplace_list_signal` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `hiring_browse_jobs` | MCP | federal_contracts | 1 |
| squeezeos-api | mcp_tool | `hiring_post_job` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `system_status` | MCP | other | 1 |
| squeezeos-api | mcp_tool | `ccs_validate` | MCP | agent_hf | 1 |
| squeezeos-api | mcp_tool | `ccs_score` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `ccs_report` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `ccs_leaderboard` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `ccs_stats` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `ccs_info` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `futures_create` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `futures_take` | MCP | trading_exec | 1 |
| squeezeos-api | mcp_tool | `futures_browse` | MCP | trading_exec | 1 |
| squeezeos-api | mcp_tool | `futures_leaderboard` | MCP | trading_exec | 1 |
| squeezeos-api | mcp_tool | `settlement_create` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `convergence_check` | MCP | federal_contracts | 1 |
| squeezeos-api | mcp_tool | `autopilot_status` | MCP | other | 1 |
| squeezeos-api | mcp_tool | `autopilot_start` | MCP | ftd_equities | 1 |
| squeezeos-api | mcp_tool | `autopilot_stop` | MCP | other | 1 |
| squeezeos-api | mcp_tool | `autopilot_trades` | MCP | other | 1 |
| squeezeos-api | mcp_tool | `circuit_breaker_reset` | MCP | other | 1 |
| squeezeos-api | mcp_tool | `beastmode_scan` | MCP | ftd_equities | 1 |
| squeezeos-api | mcp_tool | `proprietary_ema_signal` | MCP | federal_contracts | 1 |
| squeezeos-api | mcp_tool | `settlement_browse` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `settlement_trigger` | MCP | trading_exec | 1 |
| squeezeos-api | mcp_tool | `oracle_feeds` | MCP | sec_filings | 1 |
| squeezeos-api | mcp_tool | `oracle_query` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `iam_resolve` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `iam_truth` | MCP | ftd_equities | 1 |
| squeezeos-api | mcp_tool | `macro_741_scan` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `sovereign_741` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `sovereign_365` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `sovereign_triplelock` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `sovereign_full` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `post_to_slack` | MCP | federal_contracts | 1 |
| squeezeos-api | mcp_tool | `citation_score` | MCP | trading_exec | 1 |
| squeezeos-api | mcp_tool | `narrative_optimize` | MCP | infra | 1 |
| squeezeos-api | mcp_tool | `provider_score` | MCP | trading_exec | 1 |
| squeezeos-api | mcp_tool | `semantic_gaps` | MCP | ftd_equities | 1 |
| squeezeos-api | mcp_tool | `agent_economy` | MCP | trading_exec | 1 |
| squeezeos-api | mcp_tool | `truth_verify` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `memory_store` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `memory_recall` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `memory_stats` | MCP | trading_exec | 1 |
| squeezeos-api | mcp_tool | `fred_preview` | MCP | infra | 1 |
| squeezeos-api | mcp_tool | `fred_series` | MCP | crypto | 1 |
| squeezeos-api | mcp_tool | `rwa_scan` | MCP | ftd_equities | 1 |
| squeezeos-api | mcp_tool | `rwa_valuation` | MCP | rwa | 1 |
| squeezeos-api | mcp_tool | `rwa_proof_of_reserves` | MCP | rwa | 1 |
| squeezeos-api | mcp_tool | `rwa_intelligence` | MCP | rwa | 1 |

## Links

- mcp-x402 OpenAPI: https://mcp-x402.onrender.com/openapi.json
- squeezeos OpenAPI: https://squeezeos-api.onrender.com/openapi.json
- squeezeos MCP: https://squeezeos-api.onrender.com/mcp
- AWS status: https://mcp-x402.onrender.com/aws/marketplace/status
- JSON: `docs/listings/PLATFORM_API_INVENTORY.json`
- CSV: `docs/listings/PLATFORM_API_INVENTORY.csv`
