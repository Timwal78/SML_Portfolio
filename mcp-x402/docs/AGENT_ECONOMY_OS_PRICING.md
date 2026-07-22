# Agent Economy OS — Pricing Structure

Status date: 2026-07-22. This doc separates what is **live and charging
today** from what is **proposed and not yet wired** — do not present the
proposed tiers as purchasable anywhere until the corresponding Stripe
products / infrastructure exist.

## LIVE TODAY

### 1. Free / Discovery tier (the hook)
$0.00, no wallet needed. `sml_discover`, `sml_status`, `squeezeos_preview`,
`squeezeos_demo`, `squeezeos_status`, `proof_credit_score`, `proof_invoice`,
`proof_verify`, `agentcard_lookup`, `agentcard_verify`, `launchpad_list`,
`launchpad_status`, `rails_status`, `ghost_status`, `copytrader_status`,
`equities_heatmap_preview`, `options_delta_heatmap_preview`,
`nexus_agent_hire` (query mode), `forge_status`, `shadow_status`.

Purpose: any Claude/Cursor user sees real value within five minutes of
`npx @scriptmasterlabs/mcp-x402`, before spending a cent.

### 2. Pay-per-call (x402) — the core revenue engine
Source of truth: `src/server/registry/pricing.ts` (`BASE_PRICES`) +
the live `/pricing/v1/tool/<name>` API. Advertised == charged, enforced by
`tests/unit/pricing-drift.test.ts`. Current baseline bands:

| Band | Tools (examples) |
|------|------------------|
| $0.005 | `crawl_paid_fetch` |
| $0.01 | `crypto_token_price`, `crypto_trending`, `fx_exchange_rate`, `ghost_route`, `rails_transfer`, `launchpad_buy`, `agentcard_mint`, `tradier_order`, `robinhood_order`, `shadow_ingest` |
| $0.02 | `xmit_edgar_decode`, `xdeo_earnings_estimate`, `forge_llm`, `apm_negotiate`, `shadow_query`, `search_grants`, `lookup_entity` |
| $0.03 | `squeezeos_iwm`, `search_contracts`, `screen_restricted_party`, `search_trade_leads` |
| $0.05 | `leviathan_signal`, `squeezeos_scan`, `squeezeos_options`, `ftd_threshold_scan`, `copytrader_subscribe`, `backtest_run`, `backtest_validate`, `echo_pattern_match` |
| $0.10 | `squeezeos_council`, `equities_heatmap_full`, `launchpad_create` |
| $0.15 | `options_delta_heatmap_full` |

Payment rails: USDC on Base (preferred, <3s), RLUSD on XRPL, USDC on Solana.
Credit-tier discounts (ARGUS 300–850: PROTOSTAR/NEUTRON/PULSAR/QUASAR) apply
automatically at quote time.

### 3. Marketplace commission
`nexus_agent_hire` — querying is free; a commission applies on completed
hires through the SML marketplace. (Also: APM brokered execution via
`apm_execute` collects the brokerage percentage locked in the signed quote.)

### 4. Self-host / SDK (open-source funnel)
`@scriptmasterlabs/mcp-x402` is MIT. Self-hosting is free by design — it
grows the x402 ecosystem, and self-hosters' agents still pay per call when
they hit SML upstream data. The SDK (`x402Payment` wrapper) lets any MCP
server author monetize their own tools.

## PROPOSED — NOT YET WIRED (do not sell until built)

These came from the 2026-07-22 "Agent Economy OS" monetization plan. None
have Stripe products, provisioning, or enforcement yet:

- **Hosted subscription tiers ($29–$99/mo)** — higher rate limits, priority,
  dedicated instances. Would follow the existing CASCADE/AEO Stripe webhook
  pattern in SqueezeOS (`*_STRIPE_PRICE_ID` env vars, Redis-issued keys).
  Nothing exists today; the rate limiter is a flat 100/min per tool.
- **White-label / enterprise** — dedicated instance + custom tools for
  agencies. Handle via direct contact (timothy.walton45@gmail.com) until
  productized.
- **Paid npm support plans** — the package itself stays MIT/free.

When any of these gets built, update this doc and the `hermes.html` landing
page in the same commit — the landing page currently (correctly) shows no
subscribe button because there is nothing to subscribe to.

## Positioning notes

- Lead with the story ("Build Your Own Hermes"), close with the one-liner
  (`npx @scriptmasterlabs/mcp-x402`).
- The moat to emphasize: live x402 + AP2 + multi-chain in production, the
  Agent Credit Bureau (agents build financial reputation), and receipts on
  every call. Not "another data API".
- Never promise trading profits. Real backtests with honest verdicts
  (including losing ones) are themselves a differentiator — link the
  no-fake-data policy.
