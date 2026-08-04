/**
 * amb-routes.ts — Express routes for Agent Magnet Beacons
 * GET /.well-known/amb.json  (auto-refresh every 10 minutes)
 * POST /amb/refresh          (manual)
 */
import type { Express, Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import {
  buildAmbDocument,
  SAFE_PAY_TO,
  type AgentMagnetBeacon,
} from './amb-generator.js';

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
    const doc = getCachedAmbDocument(base);
    // Optional array-only mode for scanners that expect a bare beacon array
    if (req.query['format'] === 'array' || req.query['array'] === '1') {
      res
        .setHeader('Cache-Control', 'public, max-age=300')
        .setHeader('Access-Control-Allow-Origin', '*')
        .setHeader('X-AMB-Version', doc.amb_version)
        .json(doc.beacons);
      return;
    }
    res
      .setHeader('Cache-Control', 'public, max-age=300')
      .setHeader('Access-Control-Allow-Origin', '*')
      .setHeader('X-AMB-Version', doc.amb_version)
      .setHeader('Link', `<${base}/.well-known/amb.json>; rel="agent-magnet-beacon"`)
      .json(doc);
  });

  router.post('/amb/refresh', (_req: Request, res: Response) => {
    const doc = refreshBeacons();
    res.json({ ok: true, count: doc.beacons.length, pay_to: doc.pay_to, rails: doc.rails });
  });

  return router;
}

/** Mount on an existing Express app (also binds root paths). */
export function mountAMBRoutes(app: Express): void {
  const router = createAMBRouter();
  app.use(router);
}
