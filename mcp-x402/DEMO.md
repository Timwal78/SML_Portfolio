# 30-second demo (no API keys)

## Holy shit path

1. **Challenge (free):**
```bash
curl -sS https://acp-x402-scriptmasterlabs.onrender.com/x402/gas-tracker | head -c 500
# HTTP 402 — amount 1000 = $0.001 USDC on Base
```

2. **Snacks page (share this):**  
https://www.scriptmasterlabs.com/x402-snacks.html

3. **Hermes loop (Claude/Cursor):**  
https://www.scriptmasterlabs.com/hermes-loop.html

## Claude / Cursor (remote MCP)
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

## First paid calls (floor $0.001)
| Path | Price | Host |
|------|-------|------|
| `/x402/gas-tracker` | **$0.001** | ACP |
| `/x402/crypto-price` | **$0.001** | MCP |
| `/x402/grants` | **$0.001** | MCP |
| `/x402/funding-rates` | **$0.001** | ACP |
| `/x402/rwa-valuation` | **$0.001** | RWA |

## Install / run
```bash
npx @scriptmasterlabs/mcp-x402
```

## One-line paywall (your API)
```bash
# repo: packages/x402-paywall
import { x402 } from '@scriptmasterlabs/x402-paywall'
app.use('/premium', x402({ price: '0.001', payTo: '0x…', freeForHumans: true }))
```
