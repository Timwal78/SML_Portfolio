/**
 * amb-routes.ts — Express routes for Agent Magnet Beacons
 * GET /.well-known/amb.json  (auto-refresh every 10 minutes)
 * POST /amb/refresh          (manual)
 * Includes privacy-safe 24h agent traffic counters.
 */
import type { Express, Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import {
  buildAmbDocument,
  SAFE_PAY_TO,
  type AgentMagnetBeacon,
} from './amb-generator.js';
import {
  getAmbTrafficSnapshot,
  recordAmbTrafficFromRequest,
} from './amb-traffic.js';

const REFRESH_MS = 10 * 60 * 1000;

let cachedDoc: ReturnType<typeof buildAmbDocument> | null = null;
let lastRefresh = 0;

export function getCachedBeacons(): AgentMagnetBeacon[] {
  ensureFresh();
  return cachedDoc?.beacons ?? [];
}

export function getCachedAmbDocument(baseUrl?: string) {
  ensureFresh(baseUrl);
  return cachedDoc!;
}

/** Live document + traffic snapshot (not cached with beacons). */
export function getLiveAmbDocument(baseUrl?: string, req?: Request) {
  const doc = getCachedAmbDocument(baseUrl);
  const traffic = getAmbTrafficSnapshot();
  return {
    ...doc,
    traffic,
    agent_tracker: {
      unique_agents_24h: traffic.unique_agents,
      amb_fetches_24h: traffic.amb_fetches,
      list_magnets_24h: traffic.list_magnets_calls,
      paid_calls_24h: traffic.paid_calls,
      last_agent_at: traffic.last_seen_at,
      lifetime_unique_agents_approx: traffic.lifetime.unique_agents_approx,
    },
  };
}

function ensureFresh(baseUrl?: string) {
  if (!cachedDoc || Date.now() - lastRefresh > REFRESH_MS) {
    refreshBeacons(baseUrl);
  }
}

export function refreshBeacons(baseUrl?: string) {
  cachedDoc = buildAmbDocument(baseUrl);
  lastRefresh = Date.now();
  // eslint-disable-next-line no-console
  console.log(
    `[AMB] Refreshed ${cachedDoc.beacons.length} beacons payTo=${SAFE_PAY_TO} rails=${cachedDoc.rails.join(',')}`,
  );
  return cachedDoc;
}

export function createAMBRouter(): Router {
  const router = createRouter();

  router.get(['/.well-known/amb.json', '/amb.json'], (req: Request, res: Response) => {
    const host = req.headers.host || 'mcp-x402.onrender.com';
    const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
    const base = `${proto}://${host}`;
    recordAmbTrafficFromRequest('amb_fetch', req);
    const doc = getLiveAmbDocument(base, req);
    // Optional array-only mode for scanners that expect a bare beacon array
    if (req.query['format'] === 'array' || req.query['array'] === '1') {
      res
        .setHeader('Cache-Control', 'public, max-age=60')
        .setHeader('Access-Control-Allow-Origin', '*')
        .setHeader('X-AMB-Version', doc.amb_version)
        .setHeader('X-AMB-Agents-24h', String(doc.traffic.unique_agents))
        .json(doc.beacons);
      return;
    }
    res
      .setHeader('Cache-Control', 'public, max-age=60')
      .setHeader('Access-Control-Allow-Origin', '*')
      .setHeader('X-AMB-Version', doc.amb_version)
      .setHeader('X-AMB-Agents-24h', String(doc.traffic.unique_agents))
      .setHeader('Link', `<${base}/.well-known/amb.json>; rel="agent-magnet-beacon"`)
      .json(doc);
  });

  router.get('/amb/traffic', (_req: Request, res: Response) => {
    res
      .setHeader('Cache-Control', 'public, max-age=30')
      .setHeader('Access-Control-Allow-Origin', '*')
      .json(getAmbTrafficSnapshot());
  });

  router.post('/amb/refresh', (_req: Request, res: Response) => {
    const doc = refreshBeacons();
    res.json({
      ok: true,
      count: doc.beacons.length,
      pay_to: doc.pay_to,
      rails: doc.rails,
      traffic: getAmbTrafficSnapshot(),
    });
  });

  return router;
}

/** Mount on an existing Express app (also binds root paths). */
export function mountAMBRoutes(app: Express): void {
  const router = createAMBRouter();
  app.use(router);
}
