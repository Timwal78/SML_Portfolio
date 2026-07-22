# Agent Economy OS — Outreach Post Drafts

Ready-to-post copy for X, Reddit, and HN. House rules baked into every
draft: value first, affiliation disclosed, real tools/prices only, no profit
promises. The Hermes Sales Agent (SqueezeOS `agent/dept/hermes_sales.py`)
drafts thread-specific replies 24/7 into the `/api/outreach` review queue —
these are the general-purpose launch posts to use alongside it.

---

## X / Twitter

**Post 1 — the story hook**
> Everyone's sharing stories about AI agents running whole businesses overnight.
>
> The missing piece is never the LLM. It's money: agents that can pay for their own data, keep receipts, and build credit.
>
> We built that layer. 80+ MCP tools, pay-per-call in USDC/RLUSD, from $0.005:
>
> npx @scriptmasterlabs/mcp-x402

**Post 2 — the demo thread starter**
> My agent just did overnight research with its own wallet:
>
> • free catalog + previews (paid $0)
> • one squeeze signal — $0.05
> • one SEC filing parsed — $0.02
> • cryptographic receipt for every call
>
> Total: $0.07. No API keys, no billing dashboard, no human.
>
> One command: npx @scriptmasterlabs/mcp-x402

**Post 3 — the credit bureau angle**
> Wild thing nobody's talking about: agents can have credit scores now.
>
> Every reliable x402 payment raises the agent's FICO-style score (300–850). Higher tier = automatic discounts. Scores anchored on-chain, verifiable by anyone.
>
> Your agent builds financial reputation while it works.

**Post 4 — for MCP server authors**
> If you built an MCP server, you can charge for it in 5 lines:
>
> import { x402Payment } from '@scriptmasterlabs/mcp-x402-sdk'
>
> Wallet provisioning, chain routing, receipts, audit log — handled. MIT licensed.

## Reddit (r/AIAgents, r/LocalLLaMA, r/SideProject — adapt per sub)

**Title:** I built an MCP server where the agent pays for its own data (x402, from $0.005/call) — no API keys

**Body:**
> Disclosure up front: I build this (ScriptMaster Labs — solo, service-disabled-veteran-owned).
>
> The problem I kept hitting: every "autonomous agent" demo dies the moment it needs paid data, because a human has to manage API keys and billing. So the agent isn't autonomous — it's a chatbot with a chaperone.
>
> What I built instead: an MCP server (`npx @scriptmasterlabs/mcp-x402`) where the agent provisions its own wallet (OS keychain), discovers 80+ tools with live prices (`sml_discover`, free), and pays per call in USDC on Base or RLUSD on XRPL — $0.005 to $0.15 depending on the tool. Every paid call returns a receipt with a tx hash. Spend caps and deny-by-default mandates are enforced before any charge. There's also a credit-score system (300–850) that unlocks discounts as the agent pays reliably.
>
> It's MIT licensed, and there's an SDK if you want to add the same pay-per-call layer to your own MCP server.
>
> Honest caveats: the premium tools are financial/market intelligence — informational only, no profit promises, and we publish our backtests including the losing ones. Happy to answer anything about the x402 flow, chain choice, or the keychain/wallet design.

## Hacker News (Show HN)

**Title:** Show HN: mcp-x402 – an MCP server where AI agents pay per call with stablecoins

**Body:**
> Every MCP server that touches paid APIs still assumes a human manages keys and billing, which breaks the autonomy story. mcp-x402 is my attempt at the machine-native alternative: the agent gets a wallet (stored in the OS keychain), reads a price catalog, pays per call via x402 (USDC on Base preferred, RLUSD on XRPL fallback), and gets a cryptographic receipt in every response. Deny-by-default mandates and a daily spend cap sit in front of every charge.
>
> The part I find most interesting is the credit bureau: agents accumulate a FICO-style 300–850 score by paying reliably, which changes their pricing tier. Financial reputation for software.
>
> MIT licensed. The paid tools are my own financial-data stack (squeeze signals, SEC parsing, federal data) — informational, not advice, and the backtests we publish include the strategies that lost. I'd love scrutiny on the payment flow and the keychain approach. Repo: github.com/timwal78/sml_portfolio (mcp-x402/)

## Directories / communities to post into

Awesome MCP Servers (GitHub PR), mcp.so, Smithery, PulseMCP, Glama — the
Directory Ranger agent already tracks 25 of these and generates submission
packages every 4h; check its latest output before manually submitting.
