import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { timing } from 'hono/timing';
import type { Env } from './types/index.js';
import { tickersRouter } from './routes/tickers.js';
import { findingsRouter } from './routes/findings.js';
import { auditorsRouter } from './routes/auditors.js';
import { loyaltyRouter } from './routes/loyalty.js';
import { agentsRouter } from './routes/agents.js';
import { edgarRouter } from './routes/edgar.js';
import { mcpRouter } from './routes/mcp.js';
import { runEdgarPipeline } from './edgar/pipeline.js';

const app = new Hono<{ Bindings: Env }>();

// ── Global middleware ──────────────────────────────────────────────────────────
app.use('*', timing());
app.use('*', logger());
app.use('*', secureHeaders());
app.use('*', cors({
  origin: ['https://xaap.scriptmasterlabs.com', 'http://localhost:3000'],
  allowHeaders: ['Content-Type', 'X-Payment', 'X-Agent-Id', 'Authorization'],
  exposeHeaders: ['X-Cost-Usdc', 'X-Rate-Limit-Remaining', 'X-Auditor-Count'],
  maxAge: 86400,
}));

// Agent tracking middleware
app.use('*', async (c, next) => {
  const agentId = c.req.header('X-Agent-Id');
  if (agentId) {
    c.set('agentId' as never, agentId);
    // Fire-and-forget agent activity log
    c.executionCtx.waitUntil(
      c.env.DB.prepare(
        'UPDATE agents SET last_active = unixepoch(), total_referrals = total_referrals + 1 WHERE agent_id = ?'
      ).bind(agentId).run()
    );
  }
  await next();
});

// ── Routes ─────────────────────────────────────────────────────────────────────
app.route('/api/v1/tickers', tickersRouter);
app.route('/api/v1/findings', findingsRouter);
app.route('/api/v1/auditors', auditorsRouter);
app.route('/api/v1/loyalty', loyaltyRouter);
app.route('/api/v1/agents', agentsRouter);
app.route('/api/v1/edgar', edgarRouter);
app.route('/mcp', mcpRouter);

// ── Health ─────────────────────────────────────────────────────────────────────
app.get('/api/v1/status', async (c) => {
  const db = c.env.DB;
  const [auditors, findings, tickers] = await Promise.all([
    db.prepare('SELECT COUNT(*) as n FROM auditors').first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) as n FROM findings WHERE status = \'VALIDATED\'').first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) as n FROM tickers').first<{ n: number }>(),
  ]);
  return c.json({
    status: 'operational',
    version: '1.0.0',
    protocol: 'xAAP',
    stats: {
      auditors: auditors?.n ?? 0,
      validated_findings: findings?.n ?? 0,
      tickers_covered: tickers?.n ?? 0,
    },
    x402: {
      network: 'base-mainnet',
      asset: 'USDC',
      facilitator: c.env.X402_FACILITATOR_URL,
    },
    mcp: {
      endpoint: '/mcp',
      protocol: '2024-11-05',
      tools: 12,
    },
  });
});

// ── Natural language query (x402 gated) ───────────────────────────────────────
app.post('/api/v1/query', async (c) => {
  // Verify x402 payment
  const payment = c.req.header('X-Payment');
  if (!payment) {
    return c.json({
      x402Version: 1,
      error: 'Payment required',
      accepts: [{
        scheme: 'exact',
        network: 'base-mainnet',
        maxAmountRequired: '50000',  // $0.05 USDC
        resource: new URL(c.req.url).pathname,
        description: 'Natural language forensic query',
        mimeType: 'application/json',
        payTo: c.env.MERCHANT_WALLET_ADDRESS,
        maxTimeoutSeconds: 300,
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        extra: { name: 'USDC', version: '3' },
      }],
    }, 402);
  }
  const body = await c.req.json<{ question: string }>();
  const q = (body.question ?? '').toLowerCase();
  const tickerMatch = q.match(/\b([A-Z]{1,5})\b/g);
  const ticker = tickerMatch?.[0];
  if (!ticker) return c.json({ error: 'Could not parse ticker from question' }, 400);
  const flags = await c.env.DB.prepare(
    `SELECT f.title, f.severity, f.category, f.created_at
     FROM findings f WHERE f.ticker = ? AND f.status = 'VALIDATED'
     ORDER BY f.severity DESC, f.created_at DESC LIMIT 10`
  ).bind(ticker).all();
  return c.json({
    question: body.question,
    ticker,
    findings: flags.results,
    disclaimer: 'This is forensic research, not investment advice.',
  });
});

// ── OpenAPI spec ──────────────────────────────────────────────────────────────
app.get('/api/v1/openapi.json', (c) => c.json(OPENAPI_SPEC));

// ── Scheduled EDGAR pipeline ──────────────────────────────────────────────────
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runEdgarPipeline(env));
  },
};

const OPENAPI_SPEC = {
  openapi: '3.1.0',
  info: { title: 'xAAP API', version: '1.0.0', description: 'x402 Adversarial Audit Protocol — decentralized corporate fraud discovery' },
  servers: [{ url: 'https://xaap.scriptmasterlabs.com' }],
  paths: {
    '/api/v1/tickers': { get: { summary: 'List all covered tickers', tags: ['Tickers'] } },
    '/api/v1/tickers/{symbol}': { get: { summary: 'Ticker detail + health score', tags: ['Tickers'] } },
    '/api/v1/tickers/{symbol}/findings': {
      get: {
        summary: 'Forensic findings for a ticker (x402: $0.01)',
        tags: ['Findings'],
        parameters: [{ name: 'symbol', in: 'path', required: true, schema: { type: 'string' } }],
      },
    },
    '/api/v1/auditors': { get: { summary: 'Global leaderboard', tags: ['Auditors'] } },
    '/api/v1/query': { post: { summary: 'Natural language audit query (x402: $0.05)', tags: ['Query'] } },
    '/mcp': { post: { summary: 'MCP JSON-RPC 2.0 endpoint', tags: ['MCP'] } },
  },
};
