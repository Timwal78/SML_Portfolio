# 30-second demo (no API keys)

## One command
```bash
curl -sS https://mcp-x402.onrender.com/health && \
curl -sS "https://sml-rwa-api.onrender.com/x402/rwa-assets?limit=3"
```

Or:
```bash
bash scripts/demo-one-command.sh
```

## Claude / Cursor (remote MCP — free discover)
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

## First paid call (stupidly cheap)
| Path | Price | What |
|------|-------|------|
| ACP `gas_tracker` | **$0.01** | Multi-chain gas |
| ACP `rwa_intelligence` | **$0.03** | RWA scan/risk |
| x402 free lead | **$0.00** | `/x402/rwa-assets` |

Search **scriptmasterlabs** on ACP → hire **gas_tracker**.

## Install
```bash
npx @scriptmasterlabs/mcp-x402
```
