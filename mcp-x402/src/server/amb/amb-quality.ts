/**
 * amb-quality.ts — real per-tool quality metrics for AMB beacons.
 *
 * Found 2026-08-06: amb-generator.ts's defaultMagnetCatalog() fed every
 * single tool the exact same hardcoded constants — reputationScore=0.94,
 * successRate24h=0.987, uptime24h=0.999, avgLatencyMs=420 — computed from
 * nothing, applied identically regardless of whether a tool had ever been
 * called. That's a live public discovery document (GET /.well-known/amb.json)
 * presenting fabricated quality signals as real ones to any agent that
 * queries it — a direct hit against this repo's own Sovereign Data Policy
 * ("no hardcoded confidence scores, ever").
 *
 * This module replaces those constants with real numbers computed from
 * X402Stats' per-route settled/failed/latency tracking (see
 * security/x402-stats.ts's getRouteQuality()) — and, just as importantly,
 * is honest when there isn't yet a real sample to compute from, rather than
 * inventing a replacement number that merely LOOKS more sophisticated.
 *
 * Mapping caveat, disclosed rather than papered over: AMB's catalog
 * toolName field is a display label, not always the literal resource key
 * a payment gets recorded under — or even a tool that's actually callable
 * the way the catalog advertises. TOOL_RESOURCE_MAP below only contains
 * entries verified two ways: (1) the catalog's own `endpoint` for that
 * tool actually matches where the payment gets recorded, and (2) a real
 * executeX402Payment({toolName:...}) call site with that literal name
 * exists in tools/*.ts (for MCP-dispatched tools) or the literal REST
 * route exists in server/index.ts (for direct HTTP tools).
 *
 * search_grants, search_contracts, and options_flow were deliberately
 * EXCLUDED after checking, not merely skipped: their catalog entries
 * advertise `endpoint: mcp` (i.e., "call this as an MCP tool"), but no
 * MCP tool handler named search_grants/search_contracts/options_flow
 * exists anywhere in this repo — only tools/discovery.ts's catalog
 * listing and registry/pricing.ts's price table know these names; there
 * is no server.tool() registration or executeX402Payment() call site for
 * any of them. The REAL working implementations are REST routes with
 * different resource keys (/x402/grants, /x402/firms, /x402/options-flow)
 * that the catalog's `mcp` endpoint would never actually reach. Mapping
 * their scores to that REST data would have been confidently WRONG, not
 * just imprecise — an agent calling these via the advertised MCP endpoint
 * would get a tool-not-found error regardless of what score is shown.
 * (Separate finding, not fixed here: these three are advertised as
 * working paid capabilities and are not currently callable as advertised.)
 *
 * squeeze_scanner, squeezeos_council, and rwa_intelligence proxy through
 * to a separate service (SqueezeOS) whose payment tracking hasn't been
 * verified from this codebase — same reasoning, excluded rather than
 * guessed.
 */
import { X402Stats } from '../security/x402-stats.js';

/**
 * toolName -> the real resource key its payments are recorded under.
 *
 * NOT the same as the raw `resource` string passed to recordSettled/
 * recordFailed — X402Stats' routeFromResource() runs every resource
 * through `new URL(resource).pathname` first. For an opaque-path resource
 * like `mcp-tool:crypto_token_price`, Node's URL parser treats
 * `mcp-tool:` as the protocol and returns just `crypto_token_price` as
 * the pathname — the `mcp-tool:` prefix never survives into the stored
 * key. Verified directly (not assumed) with `new URL('mcp-tool:x').pathname`
 * before writing this map; a regression test in
 * tests/unit/amb-real-quality-scores.test.ts locks this in.
 */
const TOOL_RESOURCE_MAP: Record<string, string> = {
  gas_tracker: '/x402/gas-tracker',
  crypto_token_price: 'crypto_token_price',
  fx_exchange_rate: 'fx_exchange_rate',
};

export type DataConfidence = 'measured' | 'insufficient_samples' | 'not_tracked';

export interface RealToolMetrics {
  avgLatencyMs: number;
  successRate24h: number;
  uptime24h: number;
  reputationScore: number;
  settlements: number;
  dataConfidence: DataConfidence;
  sampleSize: number;
  note: string;
}

/** Below this many real settled+failed calls, a computed rate is too noisy to call "measured". */
const MIN_SAMPLES_FOR_CONFIDENCE = 5;

// The exact defaults imp-scoring.ts's scoreToolImp() already falls back to
// when reputation/successRate24h/uptime24h/avgLatencyMs are undefined —
// duplicated here (not imported) so this module can disclose plainly "these
// are the formula's own neutral cold-start prior, not a measurement" without
// creating a circular import between amb-quality.ts and imp-scoring.ts.
const COLD_START_DEFAULTS = { reputationScore: 0.94, successRate24h: 0.987, uptime24h: 0.999, avgLatencyMs: 420 };

/**
 * Real metrics for one AMB catalog tool. Never fabricates a distinct
 * "reputation" or "uptime" signal independent of what was actually
 * measured — no attestation or uptime-monitoring infrastructure exists in
 * this codebase, so both are honestly set equal to the one real signal
 * that does exist (settled-vs-failed rate), disclosed as such in `note`.
 */
export function computeRealToolMetrics(toolName: string): RealToolMetrics {
  const resource = TOOL_RESOURCE_MAP[toolName];
  if (!resource) {
    return {
      ...COLD_START_DEFAULTS,
      settlements: 0,
      dataConfidence: 'not_tracked',
      sampleSize: 0,
      note: `No verified resource-key mapping for "${toolName}" in this codebase yet (may proxy to a separate service) — using the scoring formula's own documented neutral defaults, not a measurement.`,
    };
  }

  const q = X402Stats.getInstance().getRouteQuality(resource);
  if (q.sampleSize < MIN_SAMPLES_FOR_CONFIDENCE || q.successRate === null) {
    return {
      ...COLD_START_DEFAULTS,
      settlements: q.settled,
      dataConfidence: 'insufficient_samples',
      sampleSize: q.sampleSize,
      note: `Only ${q.sampleSize} real settled/failed call(s) recorded for ${resource} so far — too few to report a measured rate, using the scoring formula's own documented neutral defaults instead.`,
    };
  }

  return {
    reputationScore: q.successRate,
    successRate24h: q.successRate,
    uptime24h: q.successRate,
    avgLatencyMs: q.avgLatencyMs ?? COLD_START_DEFAULTS.avgLatencyMs,
    settlements: q.settled,
    dataConfidence: 'measured',
    sampleSize: q.sampleSize,
    note: `Computed from ${q.settled} real settled and ${q.failed} real failed call(s) against ${resource} (cumulative since process start, not a true rolling 24h window). reputationScore/uptime24h are the same measured settled-vs-failed rate — no independent attestation or uptime-monitoring system exists yet.`,
  };
}
