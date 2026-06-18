# Contributing to mcp-x402

Thank you for contributing to the first MCP server that pays for itself.

## Values (SDVOSB)

ScriptMasterLabs is a Service-Disabled Veteran-Owned Small Business (SDVOSB). We hold these values:

- **Integrity** — No fake data, no simulated values, no shortcuts.
- **Transparency** — Every line of code is auditable. Every dollar spent is receipted.
- **Accountability** — If a payment goes through, there's a SHA-256 chained audit entry.
- **Service** — We build for operators and agents who need institutional-grade tools.

## Getting Started

```bash
git clone https://github.com/timwal78/sml_portfolio
cd mcp-x402
npm install
npm run build
npm test
```

## Non-Negotiables (from the build spec)

Before opening a PR, verify:

- [ ] N1: No private keys stored outside OS keychain
- [ ] N2: mTLS configured on all SML API calls
- [ ] N3: No PII or raw filing content in logs
- [ ] N4: Zod validation on 100% of new inputs
- [ ] N5: Audit log entries are SHA-256 HMAC chained
- [ ] N6: AP2 mandate verified before every paid call
- [ ] N7: 402Proof receipt returned with every transaction
- [ ] N8: Credit Bureau score checked for auto-approve
- [ ] N9: $50 daily spend cap enforced
- [ ] N10: Integration tests use Base Sepolia only
- [ ] N11: End-to-end latency target <3s on Base
- [ ] N12: Price cache refreshed within 60s
- [ ] N13: Multi-chain fallback within 500ms

## Code Style

- TypeScript strict mode. No `any`.
- Zod schemas for every external input.
- No `eval()`, no `Function()`, no `require()` with dynamic strings.
- No raw SQL (if DB is ever added, use parameterized queries).
- Comments only when the WHY is non-obvious.

## Pull Request Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes with 90%+ coverage
- [ ] No new dependencies without justification
- [ ] Security: no new environment variable fallbacks for secrets
- [ ] Updated `CATALOG` and `agents.json` if adding a new tool
- [ ] Tool count in README updated

## Adding a New Tool

1. Add to `src/server/tools/<name>.ts`
2. Register in `src/server/tools/index.ts`
3. Add SML API client in `src/lib/sml-api/<name>.ts`
4. Add to `CATALOG` in `src/server/registry/catalog.ts`
5. Add price to `BASE_PRICES` in `src/server/registry/pricing.ts`
6. Update `agents.json` and `llms.txt`
7. Add unit tests in `tests/unit/tools.test.ts`

## Reporting Security Issues

Email: timothy.walton45@gmail.com  
Do NOT open a public GitHub issue for security vulnerabilities.

## License

MIT. All contributions are MIT licensed.
