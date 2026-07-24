# Gov Procurement Intel

> **AI agent procurement infrastructure for federal capture** — awards, SDVOSB set-asides, agency spend, signed audit logs.

Built by a Service-Disabled Veteran · **SDVOSB** · UEI **G24VZA4RLMK3** · CAGE **21U51**

Pairs with: [`@scriptmasterlabs/agent-wallet`](https://www.npmjs.com/package/@scriptmasterlabs/agent-wallet)

## SAM.gov key

```bash
export SAM_API_KEY=your-sam-api-key
```

Without the key, award/set-aside tools still work via USAspending. **SAM opportunities require the key.**

## Install

```bash
npx @scriptmasterlabs/gov-procurement-intel
```

```json
{
  "mcpServers": {
    "gov-procurement": {
      "command": "npx",
      "args": ["-y", "@scriptmasterlabs/gov-procurement-intel"]
    }
  }
}
```

## Tools (5)

| Tool | Free? | What |
|------|-------|------|
| `search_sam_opportunities` | 3/day free | **Live SAM.gov solicitations** (requires `SAM_API_KEY`) |
| `search_contract_awards` | 3/day free | Federal contract awards (USAspending) by agency/NAICS/amount |
| `match_setasides` | 3/day free | SDVOSB / small-business set-aside award feed |
| `agency_spend_snapshot` | 3/day free | Top-tier agency obligation snapshot |
| `verify_contractor_entity` | paid meta | Recipient/entity lookup for capture research |
| `export_capture_log` | always signed | HMAC-signed procurement research audit trail |

## Pricing posture

- Free tease: 3 calls/day across search tools (local counter)
- Paid / marketplace: **$0.05–$0.10** per search (x402/ACP/API.market)
- Compliance export: include with paid or **$0.25** pack

## One sentence

Agents research federal awards and set-asides **with an audit trail** — so capture work is procurement-ready, not screenshot chaos.

## License

MIT
