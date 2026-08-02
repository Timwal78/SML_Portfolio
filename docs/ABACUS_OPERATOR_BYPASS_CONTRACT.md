# Abacus.ai ↔ ScriptMasterLabs — Operator Bypass Contract

**Status:** LIVE (2026-08-02)  
**Audience:** Abacus swarm app (`swarmagentsintelligence.scriptmasterlabs.com`)  
**Owner boundary:** User owns mcp-x402 + SqueezeOS. Abacus owns swarm UI shell only.

---

## 1. Free spine (no payment)

Base URL (already wired in Abacus `lib/squeezeos.ts`):

```
https://squeezeos-api.onrender.com
```

| Endpoint | Auth | Notes |
|----------|------|--------|
| `GET /api/status` | none | health |
| `GET /api/battle/summary` | none | battle board |
| `GET /api/oracle` | none | batch oracle |
| `GET /api/oracle/{SYMBOL}` | none | **fixed** — batch-cache first, no hang |
| `GET /api/market/scan` | none | live universe |
| `GET /api/beastmode` | none | GOD_MODE signals |

### Oracle hang (1a) — DONE
- Per-symbol `/api/oracle/AMC` previously hung on live `analyze()`.
- Live now: **200 in &lt;1s** from batch cache (`cache_age_s` present).
- Deploy: SqueezeOS `a6f29d7` (+ hang-fix lineage `f31f154` / `7d5da13`).
- **Abacus action:** keep polling `/api/oracle/{sym}`; remove any “warming forever” spinner timeout &gt; 5s — backend no longer blocks.

---

## 2. Paid intel bypass (server-side ONLY)

mcp-x402 host:

```
https://mcp-x402.onrender.com
```

### Header (exact)
```
X-Operator-Key: <SML_API_KEY>
```

**NOT** `x-api-key`.  
**NOT** browser / client bundle.  
**NOT** a spendable Base private key in the Abacus app.

### Where the key lives
- Render / Abacus **server env only** (server actions, route handlers, edge config that never ships to browser).
- Same value as operator `SML_API_KEY` on mcp-x402.

### Intended first routes (options → macro)
Call with `X-Operator-Key` so Abacus does not self-pay x402:

1. Options / flow style routes under `/x402/*` (e.g. insider, market, sec filings — discover via `GET /.well-known/x402` `paths`)
2. Then FRED / macro / 13F as needed

If bypass rejects, response is normal 401/403 — do **not** fall back to putting a hot wallet in the client.

### Stranger revenue is separate
Operator bypass = **$0 ops leverage** for the swarm UI.  
Stranger purchases still go through real x402 (Base USDC CDP path or sovereign `X-PAYMENT-TX`).

---

## 3. Payment rails (strangers / agents) — session-15 finish

### mcp-x402 + acp-x402-scriptmasterlabs (LIVE)

| Slot | Network | Asset | Header | Settlement |
|------|---------|-------|--------|------------|
| **accepts[0]** | `eip155:8453` (Base) | USDC `0x8335…2913` | `X-PAYMENT` | CDP / facilitator (Bazaar path) |
| **accepts[1]** | `eip155:4663` (Robinhood Chain) | USDG `0x5fc5…d168` | `X-PAYMENT-TX` | Sovereign on-chain verify |

- payTo: existing SML payTo EOAs (unchanged)
- USDG is **non-CDP** discovery + sovereign verify only
- Base USDC **never replaced** as slot 0

### Verify live
```
GET https://mcp-x402.onrender.com/x402/grants
→ 402, accepts[0]=eip155:8453, accepts[1]=eip155:4663 USDG

GET https://acp-x402-scriptmasterlabs.onrender.com/x402/perp-funding-aggregator
→ 402, same dual accepts
```

Deploys:
- mcp-x402: **`57279fa`** live
- acp-x402-scriptmasterlabs + acp-provider: **`75604dc`** live

---

## 4. Abacus checklist (their side)

1. **Spin-map:** confirm oracle UI uses `/api/oracle/{sym}` and stops spinning on 200 &lt; 2s  
2. **Bypass:** server-only `X-Operator-Key` for paid mcp routes — never browser  
3. **No** Base/RH private key in Next client  
4. Battle already free-spine — leave it  
5. MNEMOS = later (step 4), not blocking oracle/bypass

---

## 5. Locked order (unchanged)

1. ~~1a oracle hang~~ **DONE**  
2. Abacus spin-map (their diagnostic)  
3. Operator bypass contract **← this doc**  
4. Stranger rails (VendOS / agent402 / Glama / ACP)  
5. MNEMOS lane A/B/C later  

---

## 6. Contacts / hosts

| Host | Role |
|------|------|
| `squeezeos-api.onrender.com` | Free trading spine |
| `mcp-x402.onrender.com` | Paid MCP + operator bypass |
| `acp-x402-scriptmasterlabs.onrender.com` | ACP x402 snacks |
| `scriptmaster-vending-router.onrender.com` | Vending router (separate catalog deploy) |
| `swarmagentsintelligence.scriptmasterlabs.com` | Abacus UI |

Do not put secrets in this file. Key material stays in server env only.
