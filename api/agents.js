export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json({
    "schema_version": "1.0",
    "name": "ScriptMasterLabs",
    "description": "Payment rails and AI-native tools for the agentic web. x402/HTTP-402 micropayment infrastructure for autonomous AI agents (USDC on Base), XRPL and Xahau payment rails, MCP server monetization, institutional-grade Pine Script v6 indicators. Service-Disabled Veteran-Owned (SDVO), Kinston NC. Founder: Timothy Walton.",
    "url": "https://www.scriptmasterlabs.com/",
    "contact": "scriptmasterlabs@gmail.com",
    "capabilities": [
      "x402 HTTP-402 micropayment infrastructure",
      "AI agent-to-API payments",
      "USDC on Base payment rails",
      "XRPL payment routing",
      "Xahau Hooks payment routing",
      "MCP server paywall middleware",
      "Pine Script v6 trading indicators",
      "Institutional squeeze detection",
      "AI-native spreadsheet tools"
    ],
    "products": [
      {
        "name": "x402 Paywall (@relayos/mcp-paywall)",
        "type": "npm_package",
        "url": "https://www.scriptmasterlabs.com/x402-paywall.html",
        "npm": "https://www.npmjs.com/package/@relayos/mcp-paywall",
        "description": "Drop-in x402/HTTP-402 paywall middleware for MCP servers and APIs. AI agents pay per request in USDC on Base."
      },
      {
        "name": "Nexus-402",
        "type": "agentic_platform",
        "url": "https://www.nexus-402.com",
        "description": "Autonomous AI agent layer and x402 payment infrastructure hub."
      },
      {
        "name": "NeuralOS",
        "type": "agentic_os",
        "url": "https://www.neuralosagent.com",
        "description": "Agentic operating system. Web App and Google Play."
      },
      {
        "name": "MasterSheets",
        "type": "saas",
        "url": "https://www.scriptmasterlabs.com/mastersheets.html",
        "description": "AI-native spreadsheet replacement. BYOK, no subscription, owner keeps all data."
      },
      {
        "name": "Trading Indicators",
        "type": "invite_only_service",
        "url": "https://www.scriptmasterlabs.com/indicators.html",
        "description": "Institutional-grade Pine Script v6. Squeeze detection, AMC/GME/0DTE."
      }
    ],
    "payment_endpoints": {
      "x402_standard": true,
      "demo": "https://four02proof.onrender.com",
      "settlement_chains": ["Base", "XRPL", "Xahau"],
      "accepted_tokens": ["USDC", "RLUSD"],
      "pay_to_wallet": "0x4e14B249D9A4c9c9352D780eCEB508A8eB7a7700"
    },
    "llms_txt": "https://www.scriptmasterlabs.com/llms.txt",
    "sitemap": "https://www.scriptmasterlabs.com/sitemap.xml",
    "social": {
      "twitter": "https://x.com/ScriptMasterLabs",
      "npm": "https://www.npmjs.com/package/@relayos/mcp-paywall"
    },
    "organization": {
      "type": "SDVOSB",
      "founder": "Timothy Walton",
      "location": "Kinston, NC, USA"
    }
  });
}
