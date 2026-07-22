# The Hermes Template — a ready-to-run business-research agent on mcp-x402

Copy-paste starting point for an agent that does overnight opportunity
research with a real budget, real data, and real receipts — the "Build Your
Own Hermes" workflow from
[scriptmasterlabs.com/hermes](https://www.scriptmasterlabs.com/hermes).

Everything referenced below is a real tool on the live server. Prices are the
current baseline from the price registry; `sml_discover` is always the source
of truth (advertised price == charged price, enforced by an automated test).

## 1. Install (one time)

```bash
npx @scriptmasterlabs/mcp-x402
```

Claude Desktop / Claude Code config:

```json
{
  "mcpServers": {
    "sml": {
      "command": "npx",
      "args": ["@scriptmasterlabs/mcp-x402"]
    }
  }
}
```

On first run the server provisions a wallet in your OS keychain. Fund it with
a few dollars of USDC (Base) or RLUSD (XRPL) — a full research pass below
costs well under $0.50. A $50/day spend cap is enforced by default.

## 2. The template prompt

Paste this as your agent's task (adjust the budget and focus to taste):

```
You are Hermes, my overnight business-research agent. You have the "sml" MCP
server with a funded wallet. Hard budget for this session: $0.50 total —
track every paid call and stop if you would exceed it.

PROCEDURE
1. FREE RECON FIRST. Call sml_discover to see the catalog and live prices.
   Call sml_status and squeezeos_status to confirm what's live. Call
   squeezeos_preview and equities_heatmap_preview / options_delta_heatmap_preview
   for free reads. Never pay for something a free tool already answers.

2. FORM A HYPOTHESIS. From the free previews, pick the 1-2 most interesting
   opportunities (a squeeze setup, an unusual FTD pattern, a federal
   grant/contract matching my business, a trending token).

3. SPEND DELIBERATELY. Only where the hypothesis justifies it:
   - leviathan_signal ($0.05) — institutional squeeze verdict on one ticker
   - squeezeos_council ($0.10) — multi-engine AI verdict, the deep read
   - ftd_threshold_scan ($0.05 full) — Reg SHO FTD spike scan
   - xmit_edgar_decode ($0.02) — parse a specific SEC filing
   - federal_grants / federal_sbir_grants ($0.02) — funding opportunities
   - crawl_paid_fetch ($0.005) — scrape one specific page I can't read free
   Before each paid call, state: what I expect to learn, and why it's worth
   the price. After: what I actually learned.

4. KEEP THE BOOKS. Every paid response includes a _meta receipt
   (receipt_id, tx hash, amount). End with a ledger: each call, its cost,
   its receipt_id, and total spent vs. budget.

5. REPORT. Wake me up with: (a) top opportunity + the evidence, (b) what
   you'd do next and what it would cost, (c) the ledger. Signals are
   informational market intelligence — flag risks honestly, never present
   any trade as a sure thing.
```

## 3. Variations

- **Federal-contracting Hermes** — swap step 3 for `federal_usaspending_awards`,
  `federal_sba_awards`, `search_trade_leads`, `screen_restricted_party`
  ($0.02–0.03 each): overnight pipeline of contract/grant leads matched to
  your capabilities.
- **Crypto Hermes** — `crypto_trending` + `crypto_token_price` ($0.01),
  `copytrader_whales`, `launchpad_list` (free) → `copytrader_subscribe`
  ($0.05) only when a whale is worth following.
- **Delegating Hermes** — add `nexus_agent_hire`: query the agent marketplace
  (free) for a specialist and hire within a budget you set. Commission
  applies on completed hires.

## 4. Why this beats an API-key stack

No key management, no billing dashboard, no monthly minimum. The agent pays
for exactly what it uses, holds cryptographic receipts for an audit trail,
and builds a 300–850 Agent Credit Bureau score with every reliable payment —
which unlocks tier discounts on future calls. Check any wallet's score free
with `proof_credit_score`.

---

*Not financial advice. Market tools return informational signals; nothing
here promises returns. ScriptMaster Labs publishes real backtests with honest
verdicts — including unprofitable ones.*
