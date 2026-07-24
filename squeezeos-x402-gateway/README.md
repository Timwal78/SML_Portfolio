# SqueezeOS x402 Gateway

> **Your AI agent is a business. It just doesn’t have a bank account.**

The only MCP server that lets **AI agents** get paid, build credit, and prove compliance — **without a human merchant account**.

Landing: [scriptmasterlabs.com/agent-wallet](https://www.scriptmasterlabs.com/agent-wallet)

Built by a Service-Disabled Veteran · **SDVOSB** · UEI G24VZA4RLMK3 · CAGE 21U51

---

## Three tools. One problem.

| Tool | What it does | Who needs it |
|------|----------------|--------------|
| `collect_payment` | Agent pays before work runs. Agent wallet. No human merchant account. | Agent builders who want a **revenue center** |
| `prove_creditworthiness` | 402Proof-style score + attestation: “will this bot pay?” | MCP operators / merchants |
| `generate_compliance_log` | HMAC-signed audit trail of agent transactions | Gov / SDVOSB / enterprise procurement |

Not 43 tools. Not a protocol seminar. **Tent first.**

---

## 2-minute install

```bash
npx @scriptmasterlabs/squeezeos-x402-gateway
```

Claude / Cursor / any MCP host:

```json
{
  "mcpServers": {
    "agent-business": {
      "command": "npx",
      "args": ["-y", "@scriptmasterlabs/squeezeos-x402-gateway"]
    }
  }
}
```

Or remote catalog while you onboard:

```json
{
  "mcpServers": {
    "sml": {
      "url": "https://mcp-x402.onrender.com/mcp",
      "transport": "streamable-http"
    }
  }
}
```

Env (optional):

| Var | Default | Purpose |
|-----|---------|---------|
| `PROOF402_URL` | `https://four02proof.onrender.com` | Credit / pay facilitator |
| `AGENT_WALLET` | (generated local id) | Agent business identity |
| `COMPLIANCE_HMAC_SECRET` | dev secret | Sign audit logs |
| `PAY_TO` | ScriptMasterLabs default | Settlement address hint |

---

## Positioning (say this, not “x402 infra”)

| Wrong | Right |
|-------|--------|
| Use our x402 stack to monetize MCP | **Your AI agent is a business** |
| 14 products / cathedral | **Wallet · pay · credit · audit** |
| Sell only to protocol devs | Gov · enterprise procurement · agent builders |

### Channels
1. **Government / SDVOSB** — AI spend with audit trails  
2. **Enterprise procurement** — control autonomous spend  
3. **Agent builders** — Stripe for bots, not humans  

---

## CTA

**Get your agent a wallet** → https://www.scriptmasterlabs.com/agent-wallet  
Founder onboarding: timothy.walton45@gmail.com  

---

## License

MIT
