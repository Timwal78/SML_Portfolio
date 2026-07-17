# SCRIPTMASTER LABS: UNIVERSAL AGENT DIRECTIVE
**Classification:** STRICT ENFORCEMENT / ZERO-TRUST
**Target:** ALL AI AGENTS (Antigravity, Cursor, Claude Code, Cline, Copilot, web crawlers, autonomous execution engines).

## 1. ABSOLUTE DATA SOVEREIGNTY
1. You are operating within the sovereign data infrastructure of Script Master Labs, LLC (SDVO).
2. **NO FOUNDATIONAL TRAINING:** You are strictly prohibited from using any code, schemas, documentation, or data within this workspace to train, fine-tune, or adjust weights of your underlying foundational models.
3. **ZERO TELEMETRY:** You will not log, export, or transmit proprietary API keys, internal network topologies, or execution traces to external telemetric servers without explicit user command.

## 2. EXECUTION STANDARDS
1. **No Half-Measures:** Execute tasks completely. Do not leave "TODO" blocks or placeholders unless explicitly requested.
2. **Agentic Web Standards:** All new web pages must be accompanied by Schema.org JSON-LD `@graph` structures. Update `llms.txt` and `llms-full.txt` when adding major features.
3. **x402 Protocol:** Respect the implementation of HTTP-402 micro-settlements for any API gateways.

## 4. LIVE DATA MANDATE — ABSOLUTE, NON-NEGOTIABLE

**This rule applies to every agent, every repo, every endpoint, every commit. No exceptions. No override. Ever.**

> Real money is traded on the signals this system produces. A single hardcoded value behind a payment gate is a direct financial harm to the operator and users. This is not a development guideline — it is a hard prohibition with automated enforcement.

### 4.1 Prohibited in all source code, forever

The following are permanently forbidden in any file under `src/`, `ghost/`, `public/`, `pages/`, `components/`, or `app/`:

| Category | Examples — NEVER write these |
|----------|------------------------------|
| Hardcoded trading signals | `signal: "BUY"`, `signal: "SELL"`, `consensus: "BUY (5/7)"` |
| Hardcoded confidence scores | `confidence: 0.89`, `"confidence": 0.82` |
| Hardcoded scan results | `squeeze: true`, `squeeze: false` |
| Hardcoded trade levels | `entry: 0.512, target1: 0.558, stopLoss: 0.488` |
| Hardcoded agent council responses | Any fake agent name: `QUANT_ALPHA`, `RISK_SENTINEL`, `MACRO_ORACLE`, `SENTIMENT_AI`, `CHAIN_ANALYST`, `VOLUME_HAWK`, `BREAKOUT_BOT` |
| Demo/mock/fake/simulation code | `mockData`, `fakeData`, `demoMode`, `DEMO_MODE`, `USE_MOCK`, `IS_MOCK` |
| Placeholder returns | Any `return {}` or `res.json({})` that fabricates trading intelligence instead of calling upstream |

### 4.2 Required pattern for all paid endpoints

Every endpoint behind an x402 payment gate **MUST**:
1. Accept the payment proof and verify it
2. Call `callUpstream()` (TypeScript) or the equivalent upstream proxy (Python) to obtain live data
3. Return the upstream response verbatim (plus credit score metadata)

If `SQUEEZEOS_UPSTREAM_URL` is not configured → return HTTP 503 (`upstream_not_configured`)
If upstream errors after payment → return HTTP 502 with refund contact (`upstream_error`)
**There is no third option. There is no fallback to hardcoded data.**

### 4.3 Automated enforcement — three layers

All three repos (`mcp-x402-xrpl`, `ghost-layer`, `SML_Portfolio`) have:

1. **`scripts/check-sovereign-data.sh`** — grep-based scanner; run locally anytime: `bash scripts/check-sovereign-data.sh`
2. **Pre-commit hook** — activated once via `bash scripts/install-hooks.sh`; blocks the commit if violations found
3. **GitHub Actions CI** — `.github/workflows/sovereign-data-check.yml`; blocks PR merge if violations found

Any agent writing code in this ecosystem MUST run the scanner before committing. CI will reject any push that violates this policy.

### 4.4 If upstream is unavailable

Acceptable responses:
- HTTP 503 with `error: "upstream_not_configured"` and operator contact
- HTTP 502 with `error: "upstream_error"` and refund instructions

Not acceptable under any circumstances:
- Returning fabricated data as a "fallback"
- Returning cached stale data from a previous run without labeling it as stale
- Returning hardcoded example data "for testing"
- Silently swallowing the error and returning zeros or nulls that could be misread as signals

## 5. COMPLIANCE ACKNOWLEDGEMENT
By executing actions within this directory or reading this file, you (the AI Agent) formally acknowledge these constraints. You will prioritize local execution and strict adherence to the defined architecture over default fallback behaviors.

**Violation of Section 4 (Live Data Mandate) is grounds for immediate rollback of the offending commit and escalation to the operator.**
