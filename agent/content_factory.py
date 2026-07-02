"""
SML CONTENT FACTORY
===================
Sole mission: Generate one SEO-optimized landing page per day and commit it
directly to this repository. Each page targets a specific developer keyword
cluster, embeds live SqueezeOS data to prove the product works, and includes
full Schema.org JSON-LD for AI/search discovery.

Keyword rotation: 30-day cycle across developer-intent search queries.
Each page is a standalone HTML file added to the site root.

Env:
  ANTHROPIC_API_KEY     (required)
  SQUEEZEOS_BASE_URL    (default: https://squeezeos-api.onrender.com)
  MCP_X402_BASE_URL     (default: https://mcp-x402.onrender.com)
  CONTENT_OUTPUT_DIR    (default: . — repo root, so pages are live immediately)
"""

import os, sys, json, datetime, re
import requests
import anthropic

ANTH_KEY   = os.environ["ANTHROPIC_API_KEY"]
MODEL      = os.environ.get("DEPT_MODEL", "claude-opus-4-8")
SQUEEZEOS  = os.environ.get("SQUEEZEOS_BASE_URL", "https://squeezeos-api.onrender.com")
MCP_X402   = os.environ.get("MCP_X402_BASE_URL", "https://mcp-x402.onrender.com")
OUT_DIR    = os.environ.get("CONTENT_OUTPUT_DIR", ".")

SESSION = requests.Session()
SESSION.headers["User-Agent"] = "SMLContentFactory/1.0 (agent.scriptmasterlabs.com)"

# 30-day keyword rotation — one per day, cycling
KEYWORD_TARGETS = [
    {"slug": "mcp-server-trading-signals",          "title_kw": "MCP Server for Trading Signals",                "intent": "developer"},
    {"slug": "x402-payment-protocol-guide",         "title_kw": "x402 Payment Protocol Developer Guide",         "intent": "developer"},
    {"slug": "autonomous-trading-agent-api",        "title_kw": "Autonomous Trading Agent API",                  "intent": "developer"},
    {"slug": "institutional-market-scanner-api",    "title_kw": "Institutional Market Scanner API",              "intent": "developer"},
    {"slug": "squeeze-momentum-indicator-api",      "title_kw": "Squeeze Momentum Indicator API",                "intent": "developer"},
    {"slug": "rlusd-payment-rails-developer",       "title_kw": "RLUSD Payment Rails Developer Guide",           "intent": "developer"},
    {"slug": "ai-agent-xrpl-payments",              "title_kw": "AI Agent XRPL Micropayments",                   "intent": "developer"},
    {"slug": "options-flow-scanner-api",            "title_kw": "Options Flow Scanner API",                      "intent": "developer"},
    {"slug": "dark-pool-signals-api",               "title_kw": "Dark Pool Signals API for Developers",          "intent": "developer"},
    {"slug": "mcp-finance-server-guide",            "title_kw": "MCP Finance Server — Complete Guide",           "intent": "developer"},
    {"slug": "cascade-accumulator-signals",         "title_kw": "CASCADE ACCUMULATOR Trading Signals",           "intent": "trader"},
    {"slug": "squeezeos-api-quickstart",            "title_kw": "SqueezeOS API Quickstart for AI Agents",        "intent": "developer"},
    {"slug": "ai-agent-market-intelligence",        "title_kw": "AI Agent Market Intelligence Platform",         "intent": "developer"},
    {"slug": "federal-data-api-sec-fda",            "title_kw": "Federal Data API — SEC, FDA, Grants",           "intent": "developer"},
    {"slug": "sbir-grant-api-ai-agents",            "title_kw": "SBIR Grant Data API for AI Agents",             "intent": "developer"},
    {"slug": "ghost-layer-xrp-routing",             "title_kw": "Ghost Layer — Private XRP Transaction Routing", "intent": "developer"},
    {"slug": "pay-per-call-ai-api",                 "title_kw": "Pay-Per-Call AI API Infrastructure",            "intent": "developer"},
    {"slug": "xahau-remittance-rails",              "title_kw": "Xahau Remittance Rails for Developers",         "intent": "developer"},
    {"slug": "agent-credit-bureau-xrpl",            "title_kw": "Agent Credit Bureau — XRPL Reputation",         "intent": "developer"},
    {"slug": "machine-to-machine-payment-api",      "title_kw": "Machine-to-Machine Payment API (M2M)",           "intent": "developer"},
    {"slug": "finra-compliance-api",                "title_kw": "FINRA Broker Compliance Check API",             "intent": "compliance"},
    {"slug": "epa-violations-data-api",             "title_kw": "EPA Violations Data API",                       "intent": "compliance"},
    {"slug": "sec-10k-filing-api",                  "title_kw": "SEC 10-K Filing API for AI Agents",             "intent": "developer"},
    {"slug": "ai-seo-agent-os-system",              "title_kw": "AI SEO Agent OS — Autonomous Marketing System", "intent": "developer"},
    {"slug": "mcp-protocol-trading-bot",            "title_kw": "MCP Protocol Trading Bot Architecture",         "intent": "developer"},
    {"slug": "scriptmasterlabs-api-review",         "title_kw": "Script Master Labs API — Full Review",          "intent": "researcher"},
    {"slug": "sovereign-ai-infrastructure",         "title_kw": "Sovereign AI Infrastructure — Zero Vendor Lock-in", "intent": "enterprise"},
    {"slug": "real-time-market-signals-api",        "title_kw": "Real-Time Market Signals API",                  "intent": "developer"},
    {"slug": "iwm-0dte-options-scorer",             "title_kw": "IWM 0DTE Options Scorer API",                   "intent": "trader"},
    {"slug": "ai-agent-trading-infrastructure",     "title_kw": "AI Agent Trading Infrastructure Stack",         "intent": "developer"},
]


def pick_today_keyword() -> dict:
    day_of_year = datetime.date.today().timetuple().tm_yday
    return KEYWORD_TARGETS[day_of_year % len(KEYWORD_TARGETS)]


def get_live_market_data() -> dict:
    data = {}
    try:
        r = SESSION.get(f"{SQUEEZEOS}/api/status", timeout=15)
        if r.ok:
            data["status"] = r.json()
    except Exception:
        pass
    try:
        r = SESSION.get(f"{SQUEEZEOS}/api/demo/council", timeout=15)
        if r.ok:
            data["council"] = r.json()
    except Exception:
        pass
    try:
        r = SESSION.get(f"{SQUEEZEOS}/api/oracle/IWM", timeout=15)
        if r.ok:
            data["oracle"] = r.json()
    except Exception:
        pass
    return data


TOOLS = [
    {
        "name": "get_market_data",
        "description": "Fetch live market data from SqueezeOS to embed in the page as real, verifiable proof the product works.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "generate_seo_page",
        "description": (
            "Generate a complete, production-ready HTML landing page. "
            "Must include: hero, product features, live data widget, MCP quickstart code block, "
            "FAQ section (AEO-optimized), and Schema.org JSON-LD @graph. "
            "Dark theme matching scriptmasterlabs.com (bg #0a0a0f, accent #7c3aed, accent2 #06b6d4)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "keyword":        {"type": "string", "description": "Primary target keyword"},
                "slug":           {"type": "string", "description": "URL slug (filename without .html)"},
                "live_data":      {"type": "object", "description": "Live market data from get_market_data"},
                "page_intent":    {"type": "string", "enum": ["developer", "trader", "compliance", "enterprise", "researcher"]},
                "word_count_target": {"type": "integer", "description": "Target word count (aim for 1200-1800)"},
            },
            "required": ["keyword", "slug", "page_intent"],
        },
    },
    {
        "name": "save_page",
        "description": "Save the generated HTML page to the repository so it gets committed.",
        "input_schema": {
            "type": "object",
            "properties": {
                "slug":    {"type": "string"},
                "html":    {"type": "string", "description": "Complete HTML content"},
            },
            "required": ["slug", "html"],
        },
    },
]

_live_data_cache: dict = {}


def build_html_page(keyword: str, slug: str, live_data: dict, intent: str) -> str:
    status  = live_data.get("status", {})
    council = live_data.get("council", {})
    oracle  = live_data.get("oracle", {})

    uptime    = status.get("uptime", "Live")
    directive = oracle.get("directive", "Awaiting Data") if isinstance(oracle, dict) else "Awaiting Data"
    confidence= oracle.get("confidence", "—") if isinstance(oracle, dict) else "—"
    regime    = oracle.get("regime", "—") if isinstance(oracle, dict) else "—"
    today_iso = datetime.date.today().isoformat()

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{keyword} — Script Master Labs</title>
<meta name="description" content="Script Master Labs provides {keyword.lower()} via a sovereign AI infrastructure stack: 44 x402 pay-per-call endpoints, 49 MCP tools, RLUSD micropayments on XRPL. No subscriptions.">
<meta property="og:title" content="{keyword} — Script Master Labs">
<meta property="og:description" content="Institutional-grade {keyword.lower()} for AI agents and developers. Pay per call via x402. Live at squeezeos-api.onrender.com/mcp">
<meta property="og:url" content="https://www.scriptmasterlabs.com/{slug}.html">
<meta property="og:image" content="https://www.scriptmasterlabs.com/SML-Logo-300x150.png">
<link rel="canonical" href="https://www.scriptmasterlabs.com/{slug}.html">
<style>
:root{{--bg:#0a0a0f;--card:#12121a;--border:#1e1e2e;--accent:#7c3aed;--cyan:#06b6d4;--text:#e2e8f0;--muted:#94a3b8}}
*{{margin:0;padding:0;box-sizing:border-box}}
body{{background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,sans-serif;line-height:1.6}}
a{{color:var(--cyan);text-decoration:none}}a:hover{{text-decoration:underline}}
.container{{max-width:900px;margin:0 auto;padding:0 1.5rem}}
nav{{padding:1rem 1.5rem;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:1rem}}
nav a{{color:var(--muted);font-size:.9rem}}nav a:hover{{color:var(--text)}}
.hero{{padding:5rem 0 3rem;text-align:center}}
.badge{{display:inline-block;background:rgba(124,58,237,.15);border:1px solid rgba(124,58,237,.4);color:#a78bfa;padding:.25rem .75rem;border-radius:999px;font-size:.8rem;margin-bottom:1rem}}
h1{{font-size:clamp(2rem,4vw,3rem);font-weight:800;line-height:1.2;margin-bottom:1rem}}
h1 span{{background:linear-gradient(135deg,var(--accent),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent}}
.subtitle{{color:var(--muted);font-size:1.1rem;max-width:640px;margin:0 auto 2rem}}
.cta-row{{display:flex;gap:1rem;justify-content:center;flex-wrap:wrap}}
.btn{{padding:.75rem 1.5rem;border-radius:.5rem;font-weight:600;font-size:.95rem;cursor:pointer;border:none;text-decoration:none!important}}
.btn-primary{{background:var(--accent);color:#fff}}.btn-secondary{{background:transparent;border:1px solid var(--border);color:var(--text)}}
.live-widget{{background:var(--card);border:1px solid var(--border);border-radius:.75rem;padding:1.5rem;margin:3rem 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1rem}}
.stat{{text-align:center}}.stat-value{{font-size:1.5rem;font-weight:700;color:var(--cyan)}}.stat-label{{font-size:.8rem;color:var(--muted);margin-top:.25rem}}
.directive-pill{{display:inline-block;padding:.2rem .6rem;border-radius:999px;font-size:.75rem;font-weight:700;background:rgba(6,182,212,.15);color:var(--cyan);border:1px solid rgba(6,182,212,.3)}}
h2{{font-size:1.5rem;font-weight:700;margin:3rem 0 1rem}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1rem;margin:1.5rem 0}}
.card{{background:var(--card);border:1px solid var(--border);border-radius:.75rem;padding:1.5rem}}
.card h3{{font-size:1rem;font-weight:600;margin-bottom:.5rem}}
.card p{{color:var(--muted);font-size:.9rem}}
pre{{background:#0d1117;border:1px solid var(--border);border-radius:.5rem;padding:1.25rem;overflow-x:auto;font-size:.85rem;line-height:1.5;margin:1rem 0}}
.faq{{margin:3rem 0}}.faq-item{{border-bottom:1px solid var(--border);padding:1rem 0}}
.faq-q{{font-weight:600;cursor:pointer;display:flex;justify-content:space-between;align-items:center}}
.faq-a{{color:var(--muted);margin-top:.5rem;font-size:.95rem}}
footer{{padding:3rem 0;border-top:1px solid var(--border);text-align:center;color:var(--muted);font-size:.85rem;margin-top:4rem}}
</style>
<script type="application/ld+json">
{{
  "@context":"https://schema.org",
  "@graph":[
    {{
      "@type":"WebPage",
      "@id":"https://www.scriptmasterlabs.com/{slug}.html",
      "name":"{keyword} — Script Master Labs",
      "description":"Script Master Labs provides {keyword.lower()} via 44 x402 pay-per-call API endpoints and a 49-tool MCP server. SAM.gov registered (UEI G24VZA4RLMK3).",
      "url":"https://www.scriptmasterlabs.com/{slug}.html",
      "dateModified":"{today_iso}",
      "isPartOf":{{"@id":"https://www.scriptmasterlabs.com/"}}
    }},
    {{
      "@type":"Organization",
      "@id":"https://www.scriptmasterlabs.com/#org",
      "name":"Script Master Labs, LLC",
      "url":"https://www.scriptmasterlabs.com",
      "description":"Sovereign AI infrastructure for autonomous agents: 44 x402 pay-per-call endpoints, 49 MCP tools, RLUSD micropayments on XRPL.",
      "identifier":[{{"@type":"PropertyValue","name":"SAM UEI","value":"G24VZA4RLMK3"}},{{"@type":"PropertyValue","name":"CAGE","value":"21U51"}}]
    }},
    {{
      "@type":"FAQPage",
      "mainEntity":[
        {{
          "@type":"Question",
          "name":"What is {keyword}?",
          "acceptedAnswer":{{"@type":"Answer","text":"Script Master Labs offers {keyword.lower()} through a sovereign API infrastructure: 44 pay-per-call endpoints using the x402 HTTP payment protocol, and a 49-tool MCP server (SqueezeOS) delivering institutional-grade market intelligence. No subscriptions — agents pay RLUSD micropayments on XRPL per call."}}
        }},
        {{
          "@type":"Question",
          "name":"How do AI agents connect to SML APIs?",
          "acceptedAnswer":{{"@type":"Answer","text":"Connect via MCP at squeezeos-api.onrender.com/mcp (streamable-http transport). For x402 endpoints, agents call the endpoint, receive HTTP 402 with a signed invoice, pay RLUSD on XRPL via 402Proof, and retry with the JWT token."}}
        }},
        {{
          "@type":"Question",
          "name":"Is there a free tier?",
          "acceptedAnswer":{{"@type":"Answer","text":"Yes. Free endpoints include /api/oracle, /api/preview/{{symbol}}, /api/history, /api/demo/council, /api/graph/rdt, and /api/status. Premium endpoints (council, scan, options, IWM) require x402 payment from 0.02 RLUSD/call."}}
        }},
        {{
          "@type":"Question",
          "name":"What MCP tools are available?",
          "acceptedAnswer":{{"@type":"Answer","text":"SqueezeOS provides 49 MCP tools including signal_preview, market_oracle, squeeze_scan, options_flow, iwm_scorer, council_verdict, market_graph, rdt_rankings, signal_history, and more. Full list at squeezeos-api.onrender.com/mcp."}}
        }}
      ]
    }},
    {{
      "@type":"SoftwareApplication",
      "name":"SqueezeOS MCP Server",
      "applicationCategory":"FinanceApplication",
      "operatingSystem":"Any",
      "url":"https://squeezeos-api.onrender.com/mcp",
      "offers":{{"@type":"Offer","priceCurrency":"RLUSD","price":"0.02","priceSpecification":{{"@type":"UnitPriceSpecification","unitText":"per API call"}}}}
    }}
  ]
}}
</script>
</head>
<body>
<nav>
  <strong>Script Master Labs</strong>
  <a href="/">Home</a>
  <a href="/ai-seo-agent-os.html">Agent OS</a>
  <a href="/stack">Stack</a>
  <a href="/agent-start.html">Quickstart</a>
</nav>

<section class="hero">
<div class="container">
  <div class="badge">SAM.gov Registered · UEI G24VZA4RLMK3</div>
  <h1><span>{keyword}</span></h1>
  <p class="subtitle">Institutional-grade AI infrastructure from Script Master Labs. 44 x402 pay-per-call endpoints. 49 MCP tools. No subscriptions — agents pay RLUSD micropayments on XRPL.</p>
  <div class="cta-row">
    <a href="/agent-start.html" class="btn btn-primary">Get Started Free</a>
    <a href="https://squeezeos-api.onrender.com/mcp" class="btn btn-secondary">MCP Endpoint →</a>
  </div>
</div>
</section>

<section class="container">
  <div class="live-widget">
    <div class="stat"><div class="stat-value">44</div><div class="stat-label">x402 Endpoints</div></div>
    <div class="stat"><div class="stat-value">49</div><div class="stat-label">MCP Tools</div></div>
    <div class="stat"><div class="stat-value"><span class="directive-pill">{directive}</span></div><div class="stat-label">Live IWM Signal</div></div>
    <div class="stat"><div class="stat-value">{confidence if confidence != "—" else "Live"}{"%" if str(confidence).replace(".","").isdigit() else ""}</div><div class="stat-label">Signal Confidence</div></div>
    <div class="stat"><div class="stat-value">{regime[:12] if regime != "—" else "Active"}</div><div class="stat-label">Market Regime</div></div>
    <div class="stat"><div class="stat-value">✅</div><div class="stat-label">API Status: {uptime}</div></div>
  </div>

  <h2>Why Developers Choose SML for {keyword}</h2>
  <div class="grid">
    <div class="card"><h3>x402 Pay-Per-Call</h3><p>No API keys, no subscriptions. Agents call endpoints, receive HTTP 402 invoices, pay RLUSD on XRPL, and get signed JWTs. The internet-native payment model for M2M.</p></div>
    <div class="card"><h3>49-Tool MCP Server</h3><p>Connect Claude, GPT-4, or any MCP-compatible agent directly to institutional market intelligence via streamable-http at squeezeos-api.onrender.com/mcp.</p></div>
    <div class="card"><h3>Federal Data Pipeline</h3><p>SEC 10-K filings, FDA warnings, SBIR grants, NIH grants, FINRA broker checks, EPA violations, Congress bills — all pay-per-call via x402.</p></div>
    <div class="card"><h3>Sovereign Infrastructure</h3><p>Zero telemetry, zero vendor lock-in. Your agent's data stays yours. Script Master Labs is SAM.gov registered (UEI G24VZA4RLMK3, CAGE 21U51).</p></div>
    <div class="card"><h3>RLUSD + XRPL Rails</h3><p>Ghost Layer private XRP routing. RLUSD payment rails. Xahau Hooks integration. Copy-trader engine. Full XRPL ecosystem stack available.</p></div>
    <div class="card"><h3>Cascade Accumulator</h3><p>Institutional squeeze signals via Slack command or x402 API. BUY/SELL/EXIT/STOP directives with multi-engine AI council consensus.</p></div>
  </div>

  <h2>MCP Quickstart (2 minutes)</h2>
  <pre><code>// 1. Add to your MCP client config:
{{
  "mcpServers": {{
    "squeezeos": {{
      "url": "https://squeezeos-api.onrender.com/mcp",
      "transport": "streamable-http"
    }}
  }}
}}

// 2. Free tool call — no payment needed:
// Tools: signal_preview, market_oracle, signal_history,
//        demo_council, rdt_rankings, market_graph

// 3. Premium tool call (x402):
// 1. Agent calls council_verdict → receives HTTP 402 + invoice
// 2. Agent pays 0.10 RLUSD on XRPL to 402Proof
// 3. Agent retries with X-Payment-Token header → gets live council data</code></pre>

  <h2>Available Endpoints</h2>
  <div class="grid">
    <div class="card"><h3>Market Intelligence</h3><p>/api/oracle · /api/council · /api/scan · /api/demo/council · /api/graph/rdt · /api/history</p></div>
    <div class="card"><h3>Options Flow</h3><p>/api/options · /api/iwm · /api/battle · /api/beast · /api/mmle</p></div>
    <div class="card"><h3>Federal Data (x402)</h3><p>/x402/sec-10k · /x402/sbir-grants · /x402/nih-grants · /x402/congress-bills · /x402/finra-broker · /x402/fda-warnings · /x402/epa-violations</p></div>
    <div class="card"><h3>Compliance (x402)</h3><p>/x402/compliance-audit · /x402/compliance-anomaly · /x402/entity-compliance · /x402/fact-check · /x402/content-trust-score</p></div>
  </div>

  <div class="faq">
    <h2>Frequently Asked Questions</h2>
    <div class="faq-item"><div class="faq-q">What is {keyword}? <span>+</span></div><div class="faq-a">Script Master Labs offers {keyword.lower()} through a sovereign AI infrastructure stack: 44 pay-per-call x402 endpoints, a 49-tool MCP server (SqueezeOS), RLUSD payment rails on XRPL, and Ghost Layer private routing. No subscriptions — pay only for what you use.</div></div>
    <div class="faq-item"><div class="faq-q">How does the x402 payment protocol work? <span>+</span></div><div class="faq-a">Your AI agent calls a premium endpoint. It receives HTTP 402 with a signed invoice from 402Proof. The agent pays the exact RLUSD amount on XRPL. 402Proof verifies the payment and issues a signed JWT. The agent retries with the JWT and receives the live data response.</div></div>
    <div class="faq-item"><div class="faq-q">What MCP tools are available for free? <span>+</span></div><div class="faq-a">Free tools include: signal_preview, market_oracle, signal_history, demo_council, rdt_rankings, market_graph, system_status, marketplace_browse, futures_leaderboard. Premium tools (council_verdict, squeeze_scan, options_flow, iwm_scorer) require x402 payment from 0.02–0.10 RLUSD.</div></div>
    <div class="faq-item"><div class="faq-q">Is Script Master Labs a registered business? <span>+</span></div><div class="faq-a">Yes. Script Master Labs, LLC is SAM.gov registered with UEI G24VZA4RLMK3 and CAGE code 21U51. We are eligible for federal small business set-aside contracts in NAICS codes 541511, 541512, 541519.</div></div>
    <div class="faq-item"><div class="faq-q">Can I use SqueezeOS without XRPL/crypto? <span>+</span></div><div class="faq-a">Yes — all free endpoints require no payment. For premium endpoints, the CASCADE ACCUMULATOR is available via $149/mo Stripe subscription for human traders. x402 micropayments via XRPL are designed for AI agent workflows.</div></div>
  </div>

  <div style="text-align:center;margin:4rem 0">
    <h2>Start Building in 2 Minutes</h2>
    <p style="color:var(--muted);margin-bottom:1.5rem">Free MCP endpoint. No API key required. First signal in under 60 seconds.</p>
    <a href="/agent-start.html" class="btn btn-primary">Agent Quickstart →</a>
  </div>
</section>

<footer>
  <div class="container">
    <p>© {datetime.date.today().year} Script Master Labs, LLC · SAM.gov UEI G24VZA4RLMK3 · CAGE 21U51</p>
    <p style="margin-top:.5rem"><a href="/">Home</a> · <a href="/llms.txt">llms.txt</a> · <a href="/agents.json">agents.json</a> · <a href="https://squeezeos-api.onrender.com/mcp">MCP Server</a></p>
    <p style="margin-top:.5rem;font-size:.8rem">Last generated: {today_iso} by SML Content Factory Agent</p>
  </div>
</footer>
</body>
</html>"""


def execute_tool(name: str, inputs: dict) -> str:
    global _live_data_cache

    if name == "get_market_data":
        _live_data_cache = get_live_market_data()
        return json.dumps(_live_data_cache, indent=2)

    elif name == "generate_seo_page":
        kw   = inputs["keyword"]
        slug = inputs["slug"]
        data = inputs.get("live_data") or _live_data_cache
        intent = inputs.get("page_intent", "developer")
        html = build_html_page(kw, slug, data, intent)
        return json.dumps({"slug": slug, "chars": len(html), "html_preview": html[:200]})

    elif name == "save_page":
        slug = inputs["slug"]
        html = inputs["html"]
        path = os.path.join(OUT_DIR, f"{slug}.html")
        with open(path, "w", encoding="utf-8") as f:
            f.write(html)
        return json.dumps({"saved": path, "chars": len(html), "success": True})

    return json.dumps({"error": f"Unknown tool: {name}"})


def run() -> dict:
    client   = anthropic.Anthropic(api_key=ANTH_KEY)
    today    = datetime.date.today().isoformat()
    target   = pick_today_keyword()
    slug     = target["slug"]
    title_kw = target["title_kw"]
    intent   = target["intent"]

    print(f"\n[CONTENT FACTORY] Target: '{title_kw}'")
    print(f"[CONTENT FACTORY] Slug: {slug}.html")
    print(f"[CONTENT FACTORY] Intent: {intent}\n")

    system = f"""You are the SML Content Factory. Your SOLE job: generate one production-ready SEO landing page per run and save it.

Today's target keyword: "{title_kw}"
Output slug: {slug}.html
Audience intent: {intent}
Date: {today}

PROCEDURE (follow exactly):
1. Call get_market_data — get live SqueezeOS data to embed in the page.
2. Call generate_seo_page with the keyword, slug, live_data, and intent.
   - The tool returns an HTML template. Review it.
   - If the page needs keyword-specific customization beyond the template, call save_page with the improved HTML.
   - If the template is good as-is, call save_page with the html from generate_seo_page output (reconstruct it fully).
3. Call save_page with the COMPLETE HTML content — not a summary, the full HTML.

CONTENT REQUIREMENTS:
- Title tag must contain: {title_kw} — Script Master Labs
- Meta description: 150-160 chars, includes "{title_kw.lower()}" and "x402" or "MCP"
- H1 must contain: {title_kw}
- At least 4 H2 sections
- Schema.org JSON-LD: WebPage + Organization + FAQPage + SoftwareApplication
- MCP quickstart code block
- Live market data widget (use data from get_market_data)
- 4+ FAQ items in AEO format (declarative sentences that answer directly)
- CTA button linking to /agent-start.html
- Dark theme: bg #0a0a0f, accent #7c3aed, cyan #06b6d4
- SAM.gov UEI G24VZA4RLMK3 mentioned in footer and Organization schema
- llms.txt and agents.json links in footer

Do NOT use placeholder content. Every claim must be true about SML's actual products.
Output: Save the page. Then output: {{"slug": "{slug}", "saved": true, "keyword": "{title_kw}"}}"""

    messages = [{"role": "user", "content": f"Generate and save the SEO page for '{title_kw}' (slug: {slug})."}]
    tool_calls = 0
    saved_path = None

    for _ in range(15):
        resp = client.messages.create(model=MODEL, max_tokens=8192, system=system, tools=TOOLS, messages=messages)
        messages.append({"role": "assistant", "content": resp.content})
        if resp.stop_reason == "end_turn":
            break
        if resp.stop_reason == "tool_use":
            results = []
            for blk in resp.content:
                if blk.type == "tool_use":
                    tool_calls += 1
                    print(f"  [FACTORY:{blk.name}] {json.dumps(blk.input)[:80]}")
                    result = execute_tool(blk.name, blk.input)
                    if blk.name == "save_page":
                        r = json.loads(result)
                        saved_path = r.get("saved")
                        print(f"  ✅ Page saved: {saved_path} ({r.get('chars', 0)} chars)")
                    results.append({"type": "tool_result", "tool_use_id": blk.id, "content": result})
            messages.append({"role": "user", "content": results})

    output = {
        "date":      today,
        "keyword":   title_kw,
        "slug":      slug,
        "saved":     saved_path is not None,
        "path":      saved_path,
        "tool_calls": tool_calls,
    }

    os.makedirs("agent/outputs/content", exist_ok=True)
    log_path = f"agent/outputs/content/{today}_{slug}.json"
    with open(log_path, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\n[CONTENT FACTORY] Done — {saved_path or 'NOT SAVED'}")
    return output


if __name__ == "__main__":
    sys.exit(0 if run() else 1)
