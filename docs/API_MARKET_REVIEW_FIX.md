# {API}Market review fix (2026-08-02)

## Round 1 — reviewer blockers
1. Playground returned HTTP 402
2. OpenAPI must not require X-Coingecko-Key / X-Sam-Key / X-Openfda-Key

### Fix shipped
Free playground (no payment):
- GET https://mcp-x402.onrender.com/x402/playground
- GET https://mcp-x402.onrender.com/x402/playground/demo
- GET https://mcp-x402.onrender.com/x402/playground/grants?keyword=veteran
- GET https://mcp-x402.onrender.com/x402/playground/fred?series_id=GDP

Paid routes marketplace auth: gateway sends one of `X-Api-Market-Key`,
`X-API-Key`, `Authorization: Bearer` matching Render's
`API_MARKET_PROXY_SECRET`. BYOK: server uses `SAM_API_KEY`,
`OPENFDA_API_KEY`, `COINGECKO_API_KEY`, `FRED_API_KEY` — clients never pass
those headers.

## Round 4 (2026-08-02, same day) — "subscribed TESTER plan still gets 402 on every endpoint"

Reviewer resubscribed on a real (paid) Tester plan and hit every production
`/x402/*` endpoint through {API}Market's own API Playground — all still
402'd. This was the 4th round on the same underlying complaint. Root cause
was never actually in `requirePayment()`'s bypass logic (that code path was
correct the whole time, verified below) — it was that **{API}Market had no
way to discover the bypass mechanism from the OpenAPI spec it imports**, so
its gateway never attached any auth header to begin with, regardless of what
was configured in the seller dashboard.

Two real, separate bugs in `mcp-x402/src/server/index.ts`, both now fixed:

1. **`components.securitySchemes` (ApiMarketKey / ApiKey) was declared on
   `OPENAPI_DOC` but never referenced by any of the ~65 paid operations'
   `security` field.** An OpenAPI operation with no `security` field and no
   document-level default is read by spec-driven gateway generators as "no
   header applies here" — declaring the scheme in `components` alone does
   nothing. Fixed: every operation carrying `x-payment-info` (i.e. every
   paid route) now gets `security: [{ ApiMarketKey: [] }, { ApiKey: [] }]`
   stamped on it if it doesn't already declare its own, plus a
   document-level default `security` for tools that only read the top-level
   field.
2. **The worse one: `/openapi.json` doesn't actually serve `OPENAPI_DOC`
   directly.** It's built by `buildDiscoveryDoc()`, a separate function that
   constructs its own response object for agent402/x402scan-style discovery
   — and that object never included `components` or `security` at all, at
   any point before this fix. So even after fixing (1), the securitySchemes
   definitions were being silently dropped from the actual served spec
   ({API}Market's importer would see dangling, undefined `security`
   references). This is very likely why every previous round of this fix
   "looked right in the code" but never actually changed reviewer-observed
   behavior — nobody had traced that `/openapi.json`'s response body comes
   from `buildDiscoveryDoc()`, not `OPENAPI_DOC` itself. Fixed by forwarding
   `OPENAPI_DOC.components` and `OPENAPI_DOC.security` into
   `buildDiscoveryDoc()`'s return value.

### Verified against a live local build (not just read), 2026-08-02
- `GET /openapi.json` now includes `components.securitySchemes.{ApiMarketKey,ApiKey}`
  and every paid operation's `security` array references them; confirmed by
  parsing the actual served JSON, not by inspecting source.
- `GET /x402/grants?keyword=veteran` with no key → `402 payment_required` (unchanged, correct).
- Same call with `X-API-Key: <API_MARKET_PROXY_SECRET>` or
  `X-Api-Market-Key: <API_MARKET_PROXY_SECRET>` → payment gate clears (no
  402); response became a `502 grants_api_error` only because this sandbox
  has no outbound network path to Grants.gov, not because of auth — proves
  the bypass itself was never the broken part.
- Same call with a wrong key → still `402` (bypass doesn't false-positive).
- Full `vitest run` suite: 147 passed / 3 skipped, no regressions.

### What operator action is still needed
This fix makes the spec finally *tell* {API}Market to send an auth header —
it does not remove the need for the shared secret to actually be configured
on both ends:
- Render env `API_MARKET_PROXY_SECRET` must be set on `mcp-x402`.
- {API}Market's seller dashboard "backend auth" / gateway secret field must
  be set to the exact same value.
If either side is unset or mismatched, paid calls will still 402 — but now
for a verifiable, single reason (secret mismatch) rather than the spec never
advertising the mechanism at all.

## Paste back to reviewer
Playground free paths return 200. Production OpenAPI (`GET
https://mcp-x402.onrender.com/openapi.json`) now declares `X-Api-Market-Key`
/ `X-API-Key` as valid alternatives to x402 payment on every paid operation,
and the previously-missing `components.securitySchemes` block is now
actually present in the served spec (it was being silently dropped by a
separate discovery-doc builder before this fix — confirmed and corrected).
Please re-test on the Tester plan; if you still see 402 on that plan
specifically, it means our shared gateway secret and your dashboard's
backend-auth value don't match — happy to confirm ours immediately.
