import { type Request, type Response, type NextFunction } from 'express';

// Always-public paths: liveness probe + agent discovery documents. These must
// never sit behind the RapidAPI proxy secret, or platform health checks (Render)
// and discovery crawlers (x402scan, agentcash) get a 403 — which breaks deploys
// and de-lists the service. Only the paid data routes are gated below.
const PUBLIC_PREFIXES = ['/health', '/.well-known/', '/openapi.json', '/llms.txt', '/favicon.ico'];

export function rapidApiGuard(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env['RAPIDAPI_PROXY_SECRET'];
  if (!secret) { next(); return; }  // disabled if env var not set
  if (req.path === '/' || PUBLIC_PREFIXES.some((p) => req.path.startsWith(p))) { next(); return; }
  if (req.headers['x-rapidapi-proxy-secret'] === secret) { next(); return; }
  res.status(403).json({ error: 'Forbidden' });
}
