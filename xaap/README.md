# xAAP — x402 Adversarial Audit Protocol

> Decentralized corporate auditing infrastructure. Researchers sell verified fraud evidence via x402 micropayments. Zero custody. Zero SEC/CFTC.

**Live API:** `https://xaap.scriptmasterlabs.com`  
**MCP Endpoint:** `/mcp` (JSON-RPC 2.0)  
**Health:** `GET /api/v1/status`

## Architecture

- **Backend:** Cloudflare Workers (Hono) + D1 (SQLite) + R2 (evidence storage)
- **Payments:** x402 protocol, USDC on Base mainnet
- **Contracts:** Base L2 — xAAPCore, xAAPReputation, xAAPTreasury, xAAPLoyalty, xAAPAgentRewards
- **Data:** SEC EDGAR API (free, no auth), OpenCorporates, CourtListener
- **Frontend:** Next.js 14 (App Router), Tailwind CSS, shadcn/ui

## Setup

```bash
cd xaap
npm install

# Copy env
cp .env.example .env

# Deploy worker
npx wrangler deploy

# Deploy frontend
cd frontend && npm install && npm run build
```

## Payment Flow

```
Agent/User → HTTP GET /api/v1/tickers/:id/findings
         ← 402 Payment Required { x402Version, accepts[] }
Agent pays USDC on Base via x402
         → HTTP GET with X-PAYMENT header
         ← 200 { findings[] }
```

## MCP Integration

```json
{
  "mcpServers": {
    "xaap": {
      "url": "https://xaap.scriptmasterlabs.com/mcp",
      "transport": "streamable-http"
    }
  }
}
```

## Nobel Prize Thesis

xAAP solves four fundamental failures:
1. **Captured audit monopoly** — replaces Big-4 with competitive adversarial discovery
2. **The knowledge problem (Hayek)** — economic incentives surface dispersed forensic knowledge
3. **Credence good problem (Akerlof)** — on-chain reputation + auto-validation creates market for audit truth
4. **Short seller demonization** — decouples fraud discovery from position-taking

## Tier System

| Tier | Requirement | Perks |
|------|-------------|-------|
| CITIZEN | Connect wallet | Free delayed alerts, 1 vote/day |
| DETECTIVE | 3 reports submitted | Earn from paywall, reduced fees |
| INVESTIGATOR | 70% accuracy + 15 reports | Premium pricing, early access |
| AUDITOR | Top 50 global | Revenue share, governance |
| GRAND INQUISITOR | Hall of Fame | Lifetime revenue share, legal defense |
