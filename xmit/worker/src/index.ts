import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env } from './types';
import { tickers } from './routes/tickers';
import { insights } from './routes/insights';
import { analysts } from './routes/analysts';
import { agents } from './routes/agents';
import { loyalty } from './routes/loyalty';
import { runEdgarCron } from './edgar/cron';
import { SCHEMA_SQL } from './db/schema';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'X-PAYMENT', 'X-AGENT-ID', 'X-PAYER-ADDRESS'],
  exposeHeaders: ['X-402-Payment-Required'],
}));

app.use('*', logger());

app.use('*', async (c, next) => {
  const agentId = c.req.header('X-AGENT-ID');
  if (agentId) {
    c.env.DB
      .prepare(`
        UPDATE agent_affiliates
        SET total_requests = total_requests + 1, last_seen = datetime('now')
        WHERE agent_id = ?
      `)
      .bind(agentId)
      .run()
      .catch(() => {});
  }
  await next();
});

app.get('/', (c) =>
  c.json({
    name: 'xMIT — x402 Market Intelligence Trinity',
    version: '1.0.0',
    modules: {
      xCGO: 'Corporate Governance Oracle',
      xSTM: 'Short Thesis Marketplace',
      xIFD: 'Institutional Flow Decoder',
    },
    data: 'SEC EDGAR (free public API) — no proprietary licenses',
    payment: 'x402 / USDC on Base L2',
    docs: '/api/v1/agents/manifest.json',
    legal: {
      custody: 'ZERO — all payments are P2P via x402',
      securities: 'Analysts sell OPINIONS derived from public filings, not investment advice',
      data: '100% free public SEC EDGAR API',
    },
  })
);

app.get('/health', (c) => c.json({ status: 'ok', ts: new Date().toISOString() }));

app.get('/openapi.json', (c) => {
  const base = new URL(c.req.url).origin;
  return c.json({
    openapi: '3.1.0',
    info: {
      title: 'xMIT Market Intelligence Trinity',
      version: '1.0.0',
      description: 'Decentralized financial intelligence marketplace. All data from free SEC EDGAR API. Pay-per-insight via x402/USDC on Base.',
    },
    servers: [{ url: base }],
    paths: {
      '/api/v1/tickers': { get: { summary: 'List tickers', tags: ['Tickers'] } },
      '/api/v1/tickers/{ticker}': { get: { summary: 'Ticker summary (free)', tags: ['Tickers'], parameters: [{ name: 'ticker', in: 'path', required: true, schema: { type: 'string' } }] } },
      '/api/v1/tickers/{ticker}/governance': { get: { summary: 'xCGO governance score ($0.01)', tags: ['xCGO'] } },
      '/api/v1/tickers/{ticker}/redflags': { get: { summary: 'xSTM red flags ($0.01)', tags: ['xSTM'] } },
      '/api/v1/tickers/{ticker}/flow': { get: { summary: 'xIFD institutional flows ($0.01)', tags: ['xIFD'] } },
      '/api/v1/insights': { get: { summary: 'List insights' }, post: { summary: 'Submit insight' } },
      '/api/v1/analysts': { get: { summary: 'Analyst leaderboard (free)' } },
      '/api/v1/agents/manifest.json': { get: { summary: 'MCP/Agent discovery manifest' } },
    },
  });
});

app.get('/.well-known/agent-manifest.json', (c) => c.redirect('/api/v1/agents/manifest.json', 301));

app.route('/api/v1/tickers', tickers);
app.route('/api/v1/insights', insights);
app.route('/api/v1/analysts', analysts);
app.route('/api/v1/agents', agents);
app.route('/api/v1/loyalty', loyalty);

app.get('/api/v1/whale-movers', async (c) => {
  const rows = await c.env.DB
    .prepare(`
      SELECT ticker, institution_name, action, change_pct, estimated_value_usd, filed_at
      FROM institutional_flows
      WHERE filed_at >= datetime('now', '-7 days')
        AND (action = 'NEW' OR action = 'EXITED' OR ABS(COALESCE(change_pct, 0)) >= 50)
      ORDER BY ABS(COALESCE(estimated_value_usd, 0)) DESC
      LIMIT 20
    `)
    .all();
  return c.json({ movers: rows.results ?? [] });
});

app.get('/api/v1/short-candidates', async (c) => {
  const rows = await c.env.DB
    .prepare(`
      SELECT ticker,
             COUNT(*) as total_flags,
             SUM(CASE WHEN severity IN ('HIGH', 'CRITICAL') THEN 1 ELSE 0 END) as critical_flags,
             MAX(detected_at) as recent_activity
      FROM red_flags
      WHERE resolution_status = 'OPEN'
      GROUP BY ticker
      ORDER BY critical_flags DESC, total_flags DESC
      LIMIT 20
    `)
    .all();
  return c.json({ candidates: rows.results ?? [] });
});

app.get('/api/v1/verdict/:filingId', async (c) => {
  const filingId = c.req.param('filingId');
  const filing = await c.env.DB
    .prepare('SELECT * FROM edgar_filings WHERE accession_number = ?')
    .bind(filingId)
    .first();
  if (!filing) return c.json({ error: 'Filing not found' }, 404);

  const relatedInsights = await c.env.DB
    .prepare(`SELECT id, analyst_address, module, title, outcome_verdict FROM insights WHERE edgar_filing_id = ?`)
    .bind(filingId)
    .all();

  return c.json({ filing, relatedInsights: relatedInsights.results ?? [] });
});

app.get('/api/v1/schema', async (c) => {
  try {
    await c.env.DB.exec(SCHEMA_SQL);
    return c.json({ ok: true, message: 'Schema applied' });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runEdgarCron(env));
  },
};
