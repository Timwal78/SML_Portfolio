export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json({
    "schema_version": "1.0",
    "name": "ScriptMasterLabs",
    "description": "Payment rails and AI-native tools for the agentic web. x402/HTTP-402 micropayment infrastructure for autonomous AI agents (USDC on Base), XRPL and Xahau payment rails, Agent Credit Bureau (FICO 300-850 scoring), MCP server monetization, institutional-grade Pine Script v6 indicators. Service-Disabled Veteran-Owned (SDVO), Kinston NC. Founder: Timothy Walton.",
    "url": "https://www.scriptmasterlabs.com/",
    "contact": "scriptmasterlabs@gmail.com",
    "capabilities": [
      "x402 HTTP-402 micropayment infrastructure",
      "AI agent credit bureau FICO 300-850 scoring",
      "AI agent-to-API payments",
      "USDC on Base payment rails",
      "XRPL payment routing",
      "Xahau Hooks payment routing",
      "MCP server paywall middleware",
      "Agent intent contract law (ZeroQuery PoI)",
      "AI training data clearinghouse 70/30 rev share",
      "Pine Script v6 trading indicators",
      "Institutional squeeze detection",
      "AI-native spreadsheet tools"
    ],
    "mcp_servers": [
      {
        "name": "Agent Credit Bureau",
        "url": "https://sml-agent-credit-bureau.onrender.com/mcp",
        "landing_page": "https://www.scriptmasterlabs.com/agent-credit-bureau.html",
        "protocol": "MCP JSON-RPC 2.0",
        "tools": 5,
        "description": "FICO-style 300-850 credit scoring for AI agent XRPL wallets. Free score, paid full report (0.05 RLUSD), batch (0.01/wallet). The Equifax for autonomous agents."
      },
      {
        "name": "SqueezeOS",
        "url": "https://squeezeos-api.onrender.com/mcp",
        "protocol": "MCP JSON-RPC 2.0",
        "tools": 33,
        "description": "Institutional market intelligence: squeeze scanner, council verdicts, options flow, oracle, futures, settlement."
      },
      {
        "name": "402Proof",
        "url": "https://four02proof.onrender.com/mcp",
        "protocol": "MCP JSON-RPC 2.0",
        "tools": 11,
        "description": "x402 payment firewall: invoice, verify, agent passport, attestation."
      }
    ],
    "products": [
      {
        "name": "x402 Paywall (proof402-middleware)",
        "type": "npm_package",
        "url": "https://www.scriptmasterlabs.com/x402-paywall.html",
        "npm": "https://www.npmjs.com/package/proof402-middleware",
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
      "npm": "https://www.npmjs.com/package/proof402-middleware"
    },
    "organization": {
      "type": "SDVOSB",
      "founder": "Timothy Walton",
      "location": "Kinston, NC, USA"
    }
  });
}
