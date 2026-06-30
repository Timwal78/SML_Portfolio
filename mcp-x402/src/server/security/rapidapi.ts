import { type Request, type Response, type NextFunction } from 'express';

// Always-public paths: liveness probe + agent discovery documents. These must
// never sit behind the RapidAPI proxy secret, or platform health checks (Render)
// and discovery crawlers (x402scan, agentcash) get a 403 — which breaks deploys
// and de-lists the service. Only the paid data routes are gated below.
//
// /x402/* routes use their own payment protocol (x402/EIP-3009) — the requirePayment
// middleware inside each route handler issues the 402 challenge. Blocking here with
// a 403 prevents x402scan from seeing the challenge, so those endpoints never get
// indexed. Pass them through; requirePayment still protects them.
const PUBLIC_PREFIXES = ['/health', '/.well-known/', '/openapi.json', '/llms.txt', '/favicon.ico', '/x402/'];

export function rapidApiGuard(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env['RAPIDAPI_PROXY_SECRET'];
  if (!secret) { next(); return; }  // disabled if env var not set
  if (req.path === '/' || PUBLIC_PREFIXES.some((p) => req.path.startsWith(p))) { next(); return; }
  if (req.headers['x-rapidapi-proxy-secret'] === secret) { next(); return; }
  res.status(403).json({ error: 'Forbidden' });
}
