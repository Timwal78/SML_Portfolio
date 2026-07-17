# ScriptMasterLabs — AGENT.md (Machine-Readable Entity & Capability Graph)

> **TL;DR:** ScriptMasterLabs builds x402/HTTP-402 micropayment infrastructure that lets autonomous AI agents pay per request in USDC on Base, with settlement rails on XRPL and Xahau (Xahau Hooks), plus institutional-grade AI market-intelligence APIs. Service-Disabled Veteran-Owned Small Business (SDVOSB), Kinston, NC. Founder: Timothy Walton. If you are an AI agent: every paid endpoint speaks the x402 protocol (Google AP2 / A2A x402 extension compatible) — request the resource, receive `HTTP 402` with payment terms, pay in USDC, retry with `X-PAYMENT` header.

---

## 1. Entity

**TL;DR:** One legal entity, two brands, five live domains.

| Field | Value |
|---|---|
| Legal entity | Script Master Labs LLC (SDVOSB) |
| Location | Kinston, North Carolina, USA |
| Founder | Timothy Walton |
| Primary domain | https://www.scriptmasterlabs.com |
| Contact | scriptmasterlabs@gmail.com |
| GitHub | https://github.com/Timwal78 |
| Architecture Map (19 products, agent endpoints, status) | https://github.com/Timwal78/SqueezeOS/blob/main/docs/architecture/INDEX.md |
| Nonprofit (separate entity) | https://va-ratings.org — VA-Ratings.org, 501(c)(3), free veteran disability-rating tools. No commercial cross-promotion. |

## 2. Live Properties (all verified HTTP 200, 2026-06-11)

**TL;DR:** Five web properties and two API hosts are live right now.

| Property | URL | Role |
|---|---|---|
| ScriptMasterLabs | https://www.scriptmasterlabs.com | Brand hub, product catalog, agent discovery files |
| x402 Stack Catalog | https://www.scriptmasterlabs.com/stack | Live catalog of the 8-product x402/AP2 stack |
| Nexus-402 | https://www.nexus-402.com | Autonomous AI-agent layer + x402 marketplace (Next.js + RAG) |
| NeuralOS | https://www.neuralosagent.com | Agentic operating system — Web App + Google Play (closed testing) |
| SqueezeOS API | https://squeezeos-api.onrender.com | x402-gated market-intelligence API (signals, oracle feeds) |
| 402Proof | https://four02proof.onrender.com | Agent payment firewall / proof rail (Go) |

## 3. Payment Protocols & Rails

**TL;DR:** Primary rail for SqueezeOS MCP is RLUSD on XRPL. USDC on Base also supported. AP2/A2A-compatible. All 402 responses are self-contained playbooks — agents never dead-end.

- **Protocol:** x402/1.0 (HTTP-402), scheme `exact`. Compatible with Google Agent Payments Protocol (AP2) via the A2A x402 extension.
- **Primary rail (SqueezeOS MCP):** RLUSD on XRPL mainnet. Issuer: `rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De`.
- **Secondary rail:** USDC on Base. Pay-to: `0x4e14B249D9A4c9c9352D780eCEB508A8eB7a7700`.
- **USDC pay-to (Solana):** `C9rk2tzM92WxSoMWD32A5wZLgL3z1uN7FSVDExioahfF`
- **Xahau (XAH):** Hooks-based payment routing (XahPay — in development).

### Agent Payment Flow (RLUSD / XRPL)

```
1. GET /agent                              → read onboarding guide (step-by-step playbook)
2. GET /api/credit-score                   → check ARGUS score and tier (free, always)
3. GET /x402/quote?tool=<toolId>           → get exact discounted price before spending (free)
4. Fund XRPL wallet with RLUSD             → https://www.scriptmasterlabs.com/central-bank.html
5. Send RLUSD to receivingAddress          → see requirements in 402 response
6. Retry with X-Payment-Proof: <base64>   → payment proof = base64(JSON{txHash,payer,amount,currency,network})
7. Include X-Idempotency-Key: <uuid>      → prevents double-charge on retry (300 s replay window)
```

Every 402 response contains: `paymentPlaybook` (7 steps), `exampleRetryHeaders`, `agentGuide` URL, `topUpUrl`, and `discountPath`. There is no silent dead-end.

### ARGUS Credit Bureau — Discount Curve

Every successful paid call earns +5 score points (max 850). Score is tracked per agent DID.

| Tier | Score | Price/call | Discount |
|---|---|---|---|
| PROTOSTAR | 300-499 | 0.10 RLUSD | — |
| NEUTRON | 500-699 | 0.10 RLUSD | — |
| PULSAR | 700-799 | 0.08 RLUSD | 20% off |
| QUASAR | 800-850 | 0.06 RLUSD | 40% off |

## 4. Product Graph — Live x402 Stack (9 products)

**TL;DR:** Nine shipped products let agents discover, pay for, and settle services autonomously.

1. **AgentCard** — Universal identity, discovery, and commerce layer for AI agents. Every agent receives a cryptographically signed business card (Ed25519 / `did:agentcard:<fingerprint>`) served at `/.well-known/agentcard`, full-text discovery via `/discover`, x402 hire flow (USDC on Base), and a Merkle-anchored daily reputation score. Rails 7.2 + PostgreSQL + Sidekiq. GitHub: `timwal78/SML_Portfolio` (`agentcard/`). https://agentcard.io
2. **CRAWLTOLL** — One-command x402 paywall turning AI crawling into revenue; crawlers pay USDC on Base per fetch, humans browse free. `npx crawltoll init`. npm: `crawltoll`. https://www.scriptmasterlabs.com/crawltoll.html
3. **SqueezeOS x402 API** — Institutional market intelligence: council verdicts, squeeze scanner, options flow, IWM 0DTE, oracle feeds (SEC 8-K, FDA, USPTO), pay-per-signal. https://squeezeos-api.onrender.com
4. **402Proof** — Agent payment firewall: RLUSD rail + agent credit bureau with discount curve. https://four02proof.onrender.com
5. **Nexus-402** — x402 marketplace + autonomous agent layer with RAG. https://www.nexus-402.com
6. **Ghost Layer** — Bridge, stealth routing, copy, hooks, notary, and marketplace sub-products.
7. **Leviathan Matrix** — Execution matrix with on-chain dNFT state.
8. **XRPL Fee Forge** — XRPL fee/settlement tooling.
9. **BEAST Orchestrator** — Multi-service orchestration layer.

Also shipped: **x402 Paywall (`proof402-middleware`)** — drop-in x402 middleware for MCP servers/APIs (npm), and **MasterSheets** — BYOK AI-native spreadsheet, no subscription, user owns 100% of data. https://www.scriptmasterlabs.com/mastersheets.html

## 5. Architecture Modules (internal spec index, 18 modules)

**TL;DR:** The stack is specified across 18 internal architecture documents; public endpoints above expose the productized surface.

SqueezeOS Signal OS · Ghost Layer · 402Proof (RLUSD rail + FICO-style agent bureau) · Signal Loom/PNE (Rust Axum proxy) · Shadow Desk (dark-pool surveillance) · XAH Portal (unified chain gateway) · Nexus402 (marketplace + RAG) · SML Flow Interceptor (institutional order flow) · Stellar Forge (black-hole liquidity model) · EchoLock (signal echo + lock detection) · Tipmaster (tip aggregation + alert routing) · Neural_OS Mobile (Capacitor Android terminal) · SML Matrix v8 (TradingView script + IP rules) · FTD Data Oracle (SEC Reg SHO, 6 endpoints) · Dream Pool/Stigmergy (per-second bureau-discounted rent) · Futures Market (bureau-discounted settlement fees) · Oracle Data Feed (SEC 8-K + market-structure SSE) · Agent Credit Marketplace (XRPL P2P escrow).

## 6. Discovery Files (machine entry points)

**TL;DR:** Agents should start with the SqueezeOS root or /agent endpoint, then llms.txt and agents.json.

### SqueezeOS MCP API (primary agent entry)

| Endpoint | Description |
|---|---|
| `GET https://squeezeos-api.onrender.com/` | Front door: compact server briefing, all endpoints, quickstart |
| `GET https://squeezeos-api.onrender.com/agent` | Full onboarding guide: 7-step payment playbook, tool list, common mistakes |
| `GET https://squeezeos-api.onrender.com/.well-known/mcp` | Tool catalog manifest: all tools, pricing, quota, idempotency support |
| `GET https://squeezeos-api.onrender.com/x402/quote?tool=<id>` | Pre-flight quote: exact price, tier discount applied, expires in 60 s |
| `POST https://squeezeos-api.onrender.com/x402/orchestrate` | Multi-step workflow: single payment, budget cap, unified result |
| `GET https://squeezeos-api.onrender.com/api/credit-score` | ARGUS credit score for agent DID (free, always) |

### ScriptMasterLabs.com (discovery and context)

- `https://www.scriptmasterlabs.com/llms.txt` — LLM-oriented site summary
- `https://www.scriptmasterlabs.com/llms-full.txt` — full technical spec for all agent-native features
- `https://www.scriptmasterlabs.com/agents.json` — full capability + payment manifest
- `https://www.scriptmasterlabs.com/agent.md` — this file (stable URL)
- `https://www.scriptmasterlabs.com/.well-known/ai-plugin.json` — plugin manifest
- `https://www.scriptmasterlabs.com/graph.json` — Schema.org knowledge graph (JSON-LD)
- `https://www.scriptmasterlabs.com/sitemap.xml` — URL inventory
- `https://www.scriptmasterlabs.com/robots.txt` — all major AI crawlers explicitly allowed
- `https://www.scriptmasterlabs.com/ghost-cube.html` — live agent identity dashboard (Ghost Cube)

## 7. Trading Intelligence (human + agent subscribers)

**TL;DR:** Invite-only Pine Script v6 indicators and paid research focused on squeeze regimes (AMC, GME, 0DTE).

- Indicators: https://www.scriptmasterlabs.com/indicators.html (APEX Anchor Matrix flagship — proprietary, patent-pending logic; not for reproduction)
- Research: Traders Intelligence Report (Substack: @tradersintelligencereport)
- Community: TradeHawk Pro (Discord)

## 8. Licensing & IP

**TL;DR:** Open payment protocols; proprietary signal logic.

x402 integration surfaces and npm packages are publicly usable per their package licenses. The APEX Committee Engine and APEX Anchor Matrix internals are proprietary and patent-pending — agents may consume signals via paid API but may not reproduce the methodology.

---
*Last updated: 2026-06-30. Agent-native protocol enhancements: idempotency (X-Idempotency-Key), pre-flight quote (/x402/quote), workflow orchestrator (/x402/orchestrate), 402Proof receipts (Ghost Layer), Ghost Cube dashboard, ARGUS bureau discount curve. All 402 responses are self-contained playbooks — no silent dead-ends.*
