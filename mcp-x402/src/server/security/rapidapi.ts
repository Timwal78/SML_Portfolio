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
//
// /mcp and /sse are the actual MCP tool-call transports, and /messages is the
// companion POST endpoint the legacy SSE transport uses to actually send a
// tool call once GET /sse has opened the stream — all three are load-bearing
// for every MCP client. The whole product's pitch (agents.json, llms.txt,
// sml_discover) is "no API keys, agents pay autonomously via x402." Gating the
// transport itself behind a RapidAPI secret contradicts that: every paid MCP
// tool now verifies a real payment per call (see payments/x402.ts), so the
// payment check IS the access control here, exactly like /x402/*. There is no
// active RapidAPI relationship using this gate, so blocking these would only
// ever turn away the autonomous agents the server exists to serve.
// /api/checkout/ is the Stripe subscription entry point (Starter/Elite buttons
// on agentswarm-seo.html) — it must stay public for the same reason /x402/ does:
// it's how a payment gets *started*. Stripe itself is the access control once
// the session is created; gating the create-session call here would just 403
// every legitimate customer before they ever reach checkout.
const PUBLIC_PREFIXES = ['/health', '/api/stats', '/api/checkout/', '/.well-known/', '/openapi.json', '/llms.txt', '/agents.json', '/favicon.ico', '/x402/', '/mcp', '/sse', '/messages'];

export function rapidApiGuard(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env['RAPIDAPI_PROXY_SECRET'];
  if (!secret) { next(); return; }  // disabled if env var not set
  if (req.path === '/' || PUBLIC_PREFIXES.some((p) => req.path.startsWith(p))) { next(); return; }
  if (req.headers['x-rapidapi-proxy-secret'] === secret) { next(); return; }
  res.status(403).json({ error: 'Forbidden' });
}
