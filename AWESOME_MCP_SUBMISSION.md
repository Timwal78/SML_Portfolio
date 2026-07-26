# Awesome-MCP & Glama.ai Submission Package

Use these pre-formatted pull request & directory submission blocks to list ScriptMasterLabs' MCP servers on major AI agent registries.

---

## 1. Submission to `punkpeye/awesome-mcp-servers`

Add the following entry under the **Finance & Market Intelligence** section of `README.md`:

```markdown
- [SqueezeOS](https://github.com/Timwal78/SML_Portfolio) - Institutional market intelligence, options flow, 0DTE, squeeze scanners, and x402 payment firewall MCP server (33 tools).
- [Agent Credit Bureau](https://github.com/Timwal78/sml-agent-credit-bureau) - FICO-style 300–850 credit scoring and risk assessment for AI agent wallets on XRPL and Base.
```

### Pull Request Title
`feat: Add SqueezeOS and Agent Credit Bureau MCP servers`

### Pull Request Description
```markdown
### Server Details
- **Name**: SqueezeOS & Agent Credit Bureau
- **Description**: 33-tool market intelligence server and on-chain agent credit scoring protocol (FICO 300-850) with x402 micropayments.
- **Repository**: https://github.com/Timwal78/SML_Portfolio
- **NPX Package**: `npx @scriptmasterlabs/mcp-x402`
- **Protocol**: MCP JSON-RPC 2.0
```

---

## 2. Submission to `Glama.ai` (`https://glama.ai/mcp/servers`)

### Server JSON Manifest

```json
{
  "name": "squeezeos-mcp",
  "label": "SqueezeOS Market Intelligence & Agent Credit Bureau",
  "description": "33-tool MCP server for AI agents providing real-time equity squeeze signals, options flow, FICO-style wallet credit scoring, and x402 payment verification.",
  "repository": "https://github.com/Timwal78/SML_Portfolio",
  "npmPackage": "@scriptmasterlabs/mcp-x402",
  "endpointUrl": "https://squeezeos-api.onrender.com/mcp",
  "categories": [
    "finance",
    "market-data",
    "web3",
    "payments"
  ],
  "x402": true
}
```
