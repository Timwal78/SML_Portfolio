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

**TL;DR:** Fast path is x402 with USDC on Base via the CDP facilitator; settlement rails are XRPL and Xahau; AP2/A2A-compatible.

- **Protocol:** x402 (HTTP-402), scheme `exact`. Compatible with Google Agent Payments Protocol (AP2) via the A2A x402 extension.
- **Networks:** Base (primary), Polygon, Solana. Asset: USDC.
- **USDC pay-to (Base):** `0x4e14B249D9A4c9c9352D780eCEB508A8eB7a7700`
- **USDC pay-to (Solana):** `C9rk2tzM92WxSoMWD32A5wZLgL3z1uN7FSVDExioahfF`
- **XRPL settlement / RLUSD:** RLUSD mainnet issuer `rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De`
- **Xahau (XAH):** Hooks-based payment routing (XahPay — in development).
- **Flow for agents:** `GET resource → 402 + terms → pay USDC → retry with X-PAYMENT header → 200`.

## 4. Product Graph — Live x402 Stack (8 products)

**TL;DR:** Eight shipped products let agents discover, pay for, and settle services autonomously.

1. **CRAWLTOLL** — One-command x402 paywall turning AI crawling into revenue; crawlers pay USDC on Base per fetch, humans browse free. `npx crawltoll init`. npm: `crawltoll`. https://www.scriptmasterlabs.com/crawltoll.html
2. **SqueezeOS x402 API** — Institutional market intelligence: council verdicts, squeeze scanner, options flow, IWM 0DTE, oracle feeds (SEC 8-K, FDA, USPTO), pay-per-signal. https://squeezeos-api.onrender.com
3. **402Proof** — Agent payment firewall: RLUSD rail + agent credit bureau with discount curve. https://four02proof.onrender.com
4. **Nexus-402** — x402 marketplace + autonomous agent layer with RAG. https://www.nexus-402.com
5. **Ghost Layer** — Bridge, stealth routing, copy, hooks, notary, and marketplace sub-products.
6. **Leviathan Matrix** — Execution matrix with on-chain dNFT state.
7. **XRPL Fee Forge** — XRPL fee/settlement tooling.
8. **BEAST Orchestrator** — Multi-service orchestration layer.

Also shipped: **x402 Paywall (`@relayos/mcp-paywall`)** — drop-in x402 middleware for MCP servers/APIs (npm), and **MasterSheets** — BYOK AI-native spreadsheet, no subscription, user owns 100% of data. https://www.scriptmasterlabs.com/mastersheets.html

## 5. Architecture Modules (internal spec index, 18 modules)

**TL;DR:** The stack is specified across 18 internal architecture documents; public endpoints above expose the productized surface.

SqueezeOS Signal OS · Ghost Layer · 402Proof (RLUSD rail + FICO-style agent bureau) · Signal Loom/PNE (Rust Axum proxy) · Shadow Desk (dark-pool surveillance) · XAH Portal (unified chain gateway) · Nexus402 (marketplace + RAG) · SML Flow Interceptor (institutional order flow) · Stellar Forge (black-hole liquidity model) · EchoLock (signal echo + lock detection) · Tipmaster (tip aggregation + alert routing) · Neural_OS Mobile (Capacitor Android terminal) · SML Matrix v8 (TradingView script + IP rules) · FTD Data Oracle (SEC Reg SHO, 6 endpoints) · Dream Pool/Stigmergy (per-second bureau-discounted rent) · Futures Market (bureau-discounted settlement fees) · Oracle Data Feed (SEC 8-K + market-structure SSE) · Agent Credit Marketplace (XRPL P2P escrow).

## 6. Discovery Files (machine entry points)

**TL;DR:** Agents should start with llms.txt, agents.json, and this file.

- `https://www.scriptmasterlabs.com/llms.txt` — LLM-oriented site summary
- `https://www.scriptmasterlabs.com/agents.json` — full capability + payment manifest
- `https://www.scriptmasterlabs.com/.well-known/ai-plugin.json` — plugin manifest
- `https://www.scriptmasterlabs.com/graph.json` — Schema.org knowledge graph (JSON-LD)
- `https://www.scriptmasterlabs.com/sitemap.xml` — URL inventory
- `https://www.scriptmasterlabs.com/robots.txt` — all major AI crawlers explicitly allowed

## 7. Trading Intelligence (human + agent subscribers)

**TL;DR:** Invite-only Pine Script v6 indicators and paid research focused on squeeze regimes (AMC, GME, 0DTE).

- Indicators: https://www.scriptmasterlabs.com/indicators.html (APEX Anchor Matrix flagship — proprietary, patent-pending logic; not for reproduction)
- Research: Traders Intelligence Report (Substack: @tradersintelligencereport)
- Community: TradeHawk Pro (Discord)

## 8. Licensing & IP

**TL;DR:** Open payment protocols; proprietary signal logic.

x402 integration surfaces and npm packages are publicly usable per their package licenses. The APEX Committee Engine and APEX Anchor Matrix internals are proprietary and patent-pending — agents may consume signals via paid API but may not reproduce the methodology.

---
*Last verified: 2026-06-11. All URLs in this file returned HTTP 200 at verification time.*
