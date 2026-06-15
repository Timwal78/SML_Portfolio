import { Hono } from 'hono';
import type { Env } from '../types';

const agents = new Hono<{ Bindings: Env }>();

agents.get('/manifest.json', (c) => {
  const base = new URL(c.req.url).origin;
  return c.json({
    schema_version: '1.0',
    name: 'xMIT Market Intelligence Trinity',
    description:
      'Decentralized financial intelligence: governance oracle (xCGO), short thesis marketplace (xSTM), institutional flow decoder (xIFD). Pay-per-insight via x402/USDC on Base.',
    auth: { type: 'x402', network: 'base', asset: 'USDC' },
    api: { type: 'openapi', url: `${base}/openapi.json` },
    endpoints: [
      {
        name: 'list_tickers',
        description: 'List all tickers with active insights',
        url: `${base}/api/v1/tickers`,
        method: 'GET',
        cost: 'free',
      },
      {
        name: 'ticker_summary',
        description: 'Free summary: governance grade, red flag count, institutional sentiment',
        url: `${base}/api/v1/tickers/{ticker}`,
        method: 'GET',
        cost: 'free',
      },
      {
        name: 'governance_score',
        description: 'Full xCGO governance deep-dive from EDGAR DEF 14A (proxy)',
        url: `${base}/api/v1/tickers/{ticker}/governance`,
        method: 'GET',
        cost: { amount: '0.01', currency: 'USDC', scheme: 'x402' },
      },
      {
        name: 'red_flags',
        description: 'xSTM adversarial red flags: related-party transactions, auditor changes, insider trading clusters',
        url: `${base}/api/v1/tickers/{ticker}/redflags`,
        method: 'GET',
        cost: { amount: '0.01', currency: 'USDC', scheme: 'x402' },
      },
      {
        name: 'institutional_flow',
        description: 'xIFD decoded 13F flows: institutional accumulation/distribution from EDGAR filings',
        url: `${base}/api/v1/tickers/{ticker}/flow`,
        method: 'GET',
        cost: { amount: '0.01', currency: 'USDC', scheme: 'x402' },
      },
      {
        name: 'analyst_leaderboard',
        description: 'Global analyst leaderboard ranked by reputation and accuracy',
        url: `${base}/api/v1/analysts`,
        method: 'GET',
        cost: 'free',
      },
      {
        name: 'submit_insight',
        description: 'Submit a new research insight (governance vote, short thesis, or flow analysis)',
        url: `${base}/api/v1/insights`,
        method: 'POST',
        cost: 'free',
      },
    ],
    affiliate: {
      program: 'Agent Affiliate Program',
      revenue_share: '15%',
      tracking_header: 'X-AGENT-ID',
      register_url: `${base}/api/v1/agents/register`,
    },
  });
});

agents.post('/register', async (c) => {
  let body: { agentId: string; name?: string };
  try {
    body = await c.req.json() as { agentId: string; name?: string };
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (!body.agentId) return c.json({ error: 'agentId required' }, 400);

  await c.env.DB
    .prepare(`
      INSERT OR IGNORE INTO agent_affiliates (agent_id, name, registered_at)
      VALUES (?, ?, datetime('now'))
    `)
    .bind(body.agentId, body.name ?? null)
    .run();

  return c.json({ ok: true, agentId: body.agentId, revenueShare: '15%' }, 201);
});

agents.get('/leaderboard', async (c) => {
  const rows = await c.env.DB
    .prepare(`
      SELECT agent_id, name, total_requests, total_paid_requests,
             total_fees_earned_micro, last_seen
      FROM agent_affiliates
      ORDER BY total_paid_requests DESC
      LIMIT 50
    `)
    .all();

  return c.json({ agents: rows.results ?? [] });
});

export { agents };
