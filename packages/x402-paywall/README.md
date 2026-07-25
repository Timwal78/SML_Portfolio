# @scriptmasterlabs/x402-paywall

**One line of code. AI agents pay. No Stripe. No API keys. No accounts.**

```js
import { x402 } from '@scriptmasterlabs/x402-paywall'

app.use('/premium', x402({
  price: '0.001',
  payTo: '0xYourBaseAddress',
  freeForHumans: true, // bots/agents pay; browsers free
}))
```

## Install

```bash
npm i @scriptmasterlabs/x402-paywall
```

## What happens

1. Agent hits your route → **HTTP 402** + machine-readable `accepts[]`
2. Agent sends **0.001 USDC** on Base to `payTo`
3. Agent retries with header: `X-PAYMENT-TX: 0x<txHash>`
4. Middleware verifies the on-chain USDC transfer → your handler runs

## CRAWLTOLL mode

`freeForHumans: true` → Chrome/Safari free; GPTBot/ClaudeBot/curl/mcp pay.

## Live $0.001 snacks (already deployed)

See: https://www.scriptmasterlabs.com/x402-snacks.html

## Related

- MCP drop-in: `npx @scriptmasterlabs/mcp-x402`
- SDK for tool authors: `@scriptmasterlabs/mcp-x402-sdk`
- CRAWLTOLL product page: https://www.scriptmasterlabs.com/crawltoll.html
