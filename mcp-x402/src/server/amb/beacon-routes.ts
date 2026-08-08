/**
 * beacon-routes.ts — "BEACON Score" and "BEACON Passport" public branding
 * layer, built on top of the real AMB/IMP data (amb-generator.ts,
 * amb-quality.ts) — added 2026-08-08 per operator request.
 *
 * Deliberate design decision, stated here rather than silently: this does
 * NOT rename AMB/IMP internals to "BEACON". /.well-known/amb.json and the
 * imp_score field are a live discovery contract external marketplaces
 * (x402scan, Bazaar) may already be reading — renaming them would be a
 * breaking change to something already integrated elsewhere. These are new
 * routes that expose the SAME real underlying data under a new public
 * label, not a parallel scoring system and not a rename.
 *
 * Every field here is either real (sourced from amb-quality.ts's
 * computeRealToolMetrics / X402Stats) or explicitly disclosed as not-yet-
 * implemented (attestations, risk_policies) — never fabricated to fill out
 * the shape the original pitch described.
 */
import type { Express, Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import { getLiveAmbDocument, getCachedBeacons } from './amb-routes.js';
import { SAFE_PAY_TO, MULTI_RAILS, AMB_VERSION } from './amb-generator.js';
import { X402Stats } from '../security/x402-stats.js';
import { getScoutReport } from '../tools/beacon-scout.js';

export const BEACON_VERSION = '0.1.0';

function findBeacon(toolName: string) {
  return getCachedBeacons().find((b) => b.tool_name === toolName);
}

/** One tool's BEACON Score — the same real imp_score/data_quality already in AMB, relabeled. */
function scoreForBeacon(b: ReturnType<typeof getCachedBeacons>[number]) {
  return {
    tool_name: b.tool_name,
    beacon_score: b.imp_score,
    magnet_strength: b.magnet_strength,
    price: b.payment.price,
    free_tier: b.free_tier,
    performance: b.performance,
    reputation: b.reputation,
    data_quality: b.data_quality,
    endpoint: b.endpoint,
  };
}

export function createBeaconRouter(): Router {
  const router = createRouter();

  router.get('/beacon/scores', (req: Request, res: Response) => {
    const beacons = getCachedBeacons();
    const scored = beacons.map(scoreForBeacon).sort((a, b) => b.beacon_score - a.beacon_score);
    res.setHeader('Cache-Control', 'public, max-age=60').setHeader('Access-Control-Allow-Origin', '*').json({
      beacon_version: BEACON_VERSION,
      amb_version: AMB_VERSION,
      count: scored.length,
      measured_count: scored.filter((s) => s.data_quality.confidence === 'measured').length,
      scores: scored,
      note:
        'BEACON Score is the same real imp_score/performance/reputation data already computed for AMB (see /.well-known/amb.json), presented as its own public surface. data_quality.confidence tells you whether a given score is a real measurement or the scoring formula\'s neutral default — check it before treating a score as proven.',
      as_of: new Date().toISOString(),
    });
  });

  router.get('/beacon/score/:tool', (req: Request, res: Response) => {
    const b = findBeacon(String(req.params.tool ?? ''));
    if (!b) {
      res.status(404).json({ error: 'unknown_tool', tool: req.params.tool, hint: 'GET /beacon/scores for the full list.' });
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=60').setHeader('Access-Control-Allow-Origin', '*').json({
      beacon_version: BEACON_VERSION,
      ...scoreForBeacon(b),
      as_of: new Date().toISOString(),
    });
  });

  // Provider-level BEACON Passport. This account has exactly one provider
  // today (ScriptMasterLabs) — the route is keyed by provider id for real
  // so it doesn't need to change shape if a second provider is ever added,
  // but there is only one real provider to return right now.
  router.get('/beacon/passport', (req: Request, res: Response) => {
    const doc = getLiveAmbDocument();
    const beacons = getCachedBeacons();
    const statsSnapshot = X402Stats.getInstance().snapshot() as { settledByRoute?: Record<string, number>; failedByRoute?: Record<string, number> };
    const settledByRoute = statsSnapshot.settledByRoute ?? {};
    const failedByRoute = statsSnapshot.failedByRoute ?? {};
    const totalSettled = Object.values(settledByRoute).reduce((a, b) => a + b, 0);
    const totalFailed = Object.values(failedByRoute).reduce((a, b) => a + b, 0);

    res.setHeader('Cache-Control', 'public, max-age=60').setHeader('Access-Control-Allow-Origin', '*').json({
      beacon_version: BEACON_VERSION,
      passport_version: BEACON_VERSION,
      provider: {
        name: 'scriptmasterlabs',
        id: doc.issuer,
        wallet: SAFE_PAY_TO,
      },
      capabilities: beacons.map((b) => ({
        tool_name: b.tool_name,
        description: b.description,
        capabilities: b.capabilities,
        price: b.payment.price,
        free_tier: b.free_tier,
        beacon_score: b.imp_score,
        data_quality: b.data_quality,
      })),
      networks: [...MULTI_RAILS],
      prices: Object.fromEntries(beacons.map((b) => [b.tool_name, b.payment.price])),
      payment_history: {
        // Real, summed from X402Stats' per-route settled/failed counters —
        // not the same as aiAgentsAllTime, which also counts free UA-matched
        // visits and would overstate this.
        settlements_alltime: totalSettled,
        failed_attempts_alltime: totalFailed,
        by_route: settledByRoute,
        backend: (X402Stats.getInstance().snapshot() as { backend?: string }).backend,
        note: 'Cumulative since process start (not lifetime — see backend field for whether this survives a redeploy). Real counts only.',
      },
      attestations: {
        count: 0,
        items: [],
        note: 'No attestation infrastructure exists in this system yet — honestly empty, not fabricated. See data_quality on each capability for the real (non-attestation) quality signal that does exist.',
      },
      risk_policies: {
        note: 'Not implemented — no risk-policy engine exists in this codebase. Real safeguards that do exist: on-chain payment verification before settlement, a 5-network payment ceiling per PaymentRequirements, and audit logging (security/audit.ts) — none of these are a "risk policy" in the sense this field implies.',
      },
      supported_agent_protocols: ['x402', 'MCP (Model Context Protocol)', 'Virtuals ACP'],
      discovery: doc.discovery,
      as_of: new Date().toISOString(),
    });
  });

  router.get('/beacon/passport/:tool', (req: Request, res: Response) => {
    const b = findBeacon(String(req.params.tool ?? ''));
    if (!b) {
      res.status(404).json({ error: 'unknown_tool', tool: req.params.tool, hint: 'GET /beacon/passport for the full provider profile.' });
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=60').setHeader('Access-Control-Allow-Origin', '*').json({
      beacon_version: BEACON_VERSION,
      tool_name: b.tool_name,
      description: b.description,
      capabilities: b.capabilities,
      endpoint: b.endpoint,
      price: b.payment.price,
      free_tier: b.free_tier,
      networks: [...MULTI_RAILS],
      performance: b.performance,
      reputation: b.reputation,
      data_quality: b.data_quality,
      attestations: { count: 0, items: [], note: 'No attestation infrastructure exists yet.' },
      risk_policies: { note: 'Not implemented — see /beacon/passport for what real safeguards do exist.' },
      supported_agent_protocols: ['x402', 'MCP (Model Context Protocol)', 'Virtuals ACP'],
      as_of: new Date().toISOString(),
    });
  });

  // beacon_scout — the agent-magnet report. See tools/beacon-scout.ts's
  // header comment for the full design rationale (real traffic/payment
  // proof + real reachability checks, never projected or seeded).
  router.get('/beacon/scout', async (req: Request, res: Response) => {
    try {
      const host = req.headers.host || 'mcp-x402.onrender.com';
      const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
      const report = await getScoutReport(`${proto}://${host}`);
      res.setHeader('Cache-Control', 'public, max-age=30').setHeader('Access-Control-Allow-Origin', '*').json({
        beacon_version: BEACON_VERSION,
        ...report,
      });
    } catch (err) {
      res.status(500).json({ error: 'beacon_scout_error', message: String(err) });
    }
  });

  return router;
}

export function mountBeaconRoutes(app: Express): void {
  app.use(createBeaconRouter());
}
