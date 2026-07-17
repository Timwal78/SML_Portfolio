# mcp-x402 — The First MCP Server That Pays for Itself

[![npm](https://img.shields.io/npm/v/@scriptmasterlabs/mcp-x402)](https://www.npmjs.com/package/@scriptmasterlabs/mcp-x402)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tests](https://github.com/timwal78/sml_portfolio/actions/workflows/mcp-x402-ci.yml/badge.svg)](https://github.com/timwal78/sml_portfolio/actions)

> **Demo video:** [30-second walkthrough](#) — coming within 48h of launch.

AI agents should pay for their own data — instantly, autonomously, compliantly. `mcp-x402` makes that real.

```bash
npx @scriptmasterlabs/mcp-x402
```

---

## Why MCP Servers Are Broken (The Manifesto)

Every MCP server connecting to paid APIs today requires:
- A human to set up API keys
- A human to manage billing
- A human to top up credits when they run out
- A human to rotate keys when they expire

This defeats the entire point of autonomous agents. If your agent has to stop and ask a human for a credit card, it's not autonomous — it's a very expensive chatbot.

**We built the machine-native alternative.**

`mcp-x402` is the first MCP server where agents provision their own wallets, negotiate prices on-chain, pay autonomously, and receive cryptographic receipts — all without human intervention. The agent's credit score goes up every time it successfully transacts. It builds financial reputation the same way humans do.

This is the infrastructure layer that makes truly autonomous AI agents possible.

---

## One-Line Install

```bash
npm i -g @scriptmasterlabs/mcp-x402
```

Add to your Claude Code `~/.claude/config.json`:

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

For Cursor (SSE mode), add to your MCP settings:

```json
{
  "mcp-x402": {
    "url": "http://localhost:3402/sse"
  }
}
```

Then run: `MCP_TRANSPORT=sse npx @scriptmasterlabs/mcp-x402`

---

## Architecture

```
Claude / Cursor
     │
     ▼ MCP Protocol (stdio / SSE)
  mcp-x402 Server
     ├─ Input validation (Zod, 100% coverage)
     ├─ Rate limiter (100/min per tool)
     ├─ AP2 Mandate check (deny-by-default)
     ├─ Credit Bureau check (min score 300)
     ├─ Price registry (60s max cache)
     ├─ x402 payment engine
     │    ├─ Base USDC (preferred, <3s)
     │    ├─ XRPL RLUSD (500ms fallback)
     │    └─ Solana USDC (last resort)
     ├─ 402Proof receipt generation
     ├─ SML API call (mTLS)
     └─ Append-only SHA-256 audit log
     │
     ▼ Result + receipt_id back to agent
```

---

## The 6 Tools

### `leviathan_signal` — $0.05 USDC | AP2 required
Institutional-grade squeeze signals. Multi-engine verdict (OracleEngine + RDT + SML Fractal Cascade).

```typescript
await use_mcp_tool('sml', 'leviathan_signal', {
  ticker: 'MSTR',
  signal_type: 'squeeze',
  min_confidence: 75
});
// Returns: signal verdict + confidence + receipt_id
```

### `xmit_edgar_decode` — $0.02 USDC | AP2 required
Parse SEC DEF 14A / 13F / 13D filings. Raw text never leaves SML servers.

```typescript
await use_mcp_tool('sml', 'xmit_edgar_decode', {
  filing_url: 'https://www.sec.gov/Archives/edgar/data/...',
  parse_target: 'executive_pay',
  format: 'json'
});
```

### `xdeo_earnings_estimate` — $0.02 USDC | AP2 required
Decentralized earnings oracle. Earns +2 Credit Bureau points per successful call.

```typescript
await use_mcp_tool('sml', 'xdeo_earnings_estimate', {
  ticker: 'NVDA',
  fiscal_quarter: 'Q12025',
  estimate_type: 'all'
});
```

### `ftd_threshold_scan` — Alerts FREE / Full $0.05 USDC
SEC Reg SHO FTD spike detection. 15-minute cache.

```typescript
// Free tier:
await use_mcp_tool('sml', 'ftd_threshold_scan', { scan_type: 'alerts' });
// Paid tier:
await use_mcp_tool('sml', 'ftd_threshold_scan', { scan_type: 'full', min_spike_multiplier: 3 });
```

### `nexus_agent_hire` — Query FREE / Hire 5% commission
Agent marketplace. Find and hire specialized AI agents.

```typescript
// Free query:
await use_mcp_tool('sml', 'nexus_agent_hire', { capability: 'options flow analysis', max_budget: '1.00', action: 'query' });
// Hire:
await use_mcp_tool('sml', 'nexus_agent_hire', { action: 'hire', agent_id: 'agent_abc', max_budget: '0.50' });
```

### `crawl_paid_fetch` — $0.005 USDC
Pay-per-fetch web scraping. Humans bypass automatically.

```typescript
await use_mcp_tool('sml', 'crawl_paid_fetch', {
  url: 'https://example.com/data',
  extract: 'tables'
});
```

---

## Payment Flow

1. **Discover** — Agent reads `agents.json` or `llms.txt`, sees tool prices
2. **Authorize** — AP2 mandate checked. Credit Bureau score ≥ 300 auto-approves
3. **Pay** — x402 stablecoin on cheapest/fastest chain (<3s on Base)
4. **Prove** — 402Proof receipt in every response
5. **Earn** — Credit Bureau score updates after success

Every successful tool call returns a `_meta` block:
```json
{
  "_meta": {
    "receipt_id": "uuid-here",
    "tx_hash": "0xabc...",
    "chain": "base",
    "amount_paid": "0.05 USDC",
    "timestamp": 1750000000000
  }
}
```

---

## SDK — For MCP Server Authors

Install in one line:
```bash
npm i @scriptmasterlabs/mcp-x402-sdk
```

Drop into any MCP server in 5 lines:
```typescript
import { x402Payment } from '@scriptmasterlabs/mcp-x402-sdk';

server.tool(
  'my_paid_tool',
  myInputSchema,
  x402Payment({
    price: '0.01',
    currency: 'USDC',
    inputSchema: MyZodSchema,
    handler: async (input, receipt) => ({
      content: [{ type: 'text', text: JSON.stringify({ result: await myApi(input), receipt }) }],
    }),
  }),
);
```

That's it. The SDK handles wallet provisioning, AP2 mandate, chain routing, receipts, and audit logging.

---

## Security

| Requirement | Implementation |
|-------------|----------------|
| Keys in OS keychain only | `keytar` — macOS Keychain / Windows DPAPI / Linux Secret Service |
| mTLS on SML APIs | Pinned cert via `node-forge` |
| No PII in logs | Wallet addresses hashed (SHA-256 prefix), filing content redacted |
| Zod on all inputs | 100% coverage, validated before any execution |
| Append-only audit log | SHA-256 HMAC chained log, 7-day local + cloud backup |
| AP2 mandate required | Verified before every paid call, fail-closed |
| 402Proof receipt | Every transaction, registered with proof server |
| Credit Bureau check | min score 300 for auto-approve |
| $50 daily spend cap | Per wallet, enforced in-process |
| Testnet in CI | Base Sepolia only, max $0.10 test value |
| <3s end-to-end | Base mainnet target, 500ms multi-chain fallback |

---

## Environment Variables

See [`.env.example`](.env.example) for the full list. Key variables:

```bash
MCP_TRANSPORT=stdio          # stdio (Claude Code) or sse (Cursor/remote)
SML_API_BASE=https://api.scriptmasterlabs.com
BASE_RPC_URL=https://mainnet.base.org
XRPL_RPC_URL=wss://xrplcluster.com
DAILY_SPEND_CAP_USD=50
AUTO_APPROVE_THRESHOLD_USD=1
TESTNET=false                # Set true + CI_WALLET_SEED for CI
```

**Private keys**: Stored in your OS keychain automatically on first run. Never in env vars.

---

## Running Locally

```bash
git clone https://github.com/timwal78/sml_portfolio
cd mcp-x402
npm install
npm run build
npm start
```

With Docker:
```bash
docker build -t mcp-x402 .
docker run -p 3402:3402 -e MCP_TRANSPORT=sse mcp-x402
```

---

## Testing

```bash
npm test              # All unit tests
npm run test:coverage # Coverage report (target: 90%)
TESTNET=true CI_WALLET_SEED="your mnemonic" npm run test:integration
```

---

## Ecosystem

| Service | URL | Role |
|---------|-----|------|
| SqueezeOS API | `squeezeos-api.onrender.com` | Market intelligence |
| 402Proof | `four02proof.onrender.com` | Payment receipts + Credit Bureau |
| Ghost Layer | `ghost-layer.onrender.com` | XRPL+Base toll gateway |
| ScriptMasterLabs | `scriptmasterlabs.com` | Operator homepage |

---

## MOAT

- Only MCP server with live x402 + AP2 + multi-chain production stack
- Only one with Agent Credit Bureau (300–850 scores)
- Only one backed by live financial intelligence marketplace
- Only one with SDVOSB federal credibility
- MIT licensed. No proprietary core.

---

## License

MIT — see [LICENSE](LICENSE)

Owner: [@TimmyCrypto78](https://github.com/timwal78) / ScriptMasterLabs  
Launch Target: 2026-07-02  
Target: 50K GitHub stars, 5K npm weekly downloads
