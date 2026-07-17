import { Hono } from 'hono';
import type { Env } from '../types';
import { XCGOModule } from '../modules/xcgo';
import { XSTMModule } from '../modules/xstm';
import { XIFDModule } from '../modules/xifd';

const tickers = new Hono<{ Bindings: Env }>();

tickers.get('/', async (c) => {
  const rows = await c.env.DB
    .prepare(`
      SELECT
        ticker,
        MAX(company_name) as company_name,
        COUNT(DISTINCT id) as insight_count,
        MAX(submitted_at) as last_insight
      FROM insights
      GROUP BY ticker
      ORDER BY insight_count DESC
      LIMIT 100
    `)
    .all<{ ticker: string; company_name: string; insight_count: number; last_insight: string }>();

  return c.json({
    tickers: rows.results ?? [],
    total: rows.results?.length ?? 0,
  });
});

tickers.get('/:ticker', async (c) => {
  const ticker = c.req.param('ticker').toUpperCase();
  const xcgo = new XCGOModule(c.env);
  const xstm = new XSTMModule(c.env);
  const xifd = new XIFDModule(c.env);

  const [governance, redFlagCount, sentiment, topInsights] = await Promise.all([
    xcgo.getGovernanceScore(ticker).catch(() => null),
    c.env.DB
      .prepare(`SELECT COUNT(*) as cnt FROM red_flags WHERE ticker = ? AND resolution_status = 'OPEN'`)
      .bind(ticker)
      .first<{ cnt: number }>()
      .then((r) => r?.cnt ?? 0),
    xifd.getSentiment(ticker),
    c.env.DB
      .prepare(`
        SELECT id, analyst_address, module, title, summary, confidence_score,
               price_micro, submitted_at, purchase_count
        FROM insights
        WHERE ticker = ?
        ORDER BY purchase_count DESC, confidence_score DESC
        LIMIT 5
      `)
      .bind(ticker)
      .all(),
  ]);

  return c.json({
    ticker,
    governanceGrade: governance?.overallGrade ?? null,
    governanceScore: governance?.score ?? null,
    redFlagCount,
    institutionalSentiment: sentiment,
    topInsights: topInsights.results ?? [],
    freePreview: {
      governance: governance
        ? {
            grade: governance.overallGrade,
            redFlags: governance.redFlagCount,
            consensus: governance.analystConsensus,
          }
        : null,
    },
  });
});

tickers.get('/:ticker/governance', async (c) => {
  const ticker = c.req.param('ticker').toUpperCase();
  const xcgo = new XCGOModule(c.env);
  const score = await xcgo.getGovernanceScore(ticker);
  if (!score) return c.json({ error: 'No governance data' }, 404);
  return c.json(score);
});

tickers.get('/:ticker/redflags', async (c) => {
  const ticker = c.req.param('ticker').toUpperCase();
  const xstm = new XSTMModule(c.env);
  const flags = await xstm.getRedFlags(ticker);
  return c.json({ ticker, flags, total: flags.length });
});

tickers.get('/:ticker/flow', async (c) => {
  const ticker = c.req.param('ticker').toUpperCase();
  const xifd = new XIFDModule(c.env);
  const [flows, sentiment] = await Promise.all([
    xifd.getFlowsForTicker(ticker, 30),
    xifd.getSentiment(ticker),
  ]);
  return c.json({ ticker, sentiment, flows, total: flows.length });
});

tickers.get('/:ticker/insights', async (c) => {
  const ticker = c.req.param('ticker').toUpperCase();
  const module = c.req.query('module');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);

  let query = `
    SELECT i.id, i.analyst_address, i.module, i.title, i.summary,
           i.confidence_score, i.price_micro, i.submitted_at,
           i.purchase_count, i.view_count, i.outcome_verdict,
           a.reputation_score, a.tier
    FROM insights i
    LEFT JOIN analysts a ON a.address = i.analyst_address
    WHERE i.ticker = ?
  `;
  const params: unknown[] = [ticker];

  if (module && ['xcgo', 'xstm', 'xifd'].includes(module)) {
    query += ' AND i.module = ?';
    params.push(module);
  }

  query += ' ORDER BY i.submitted_at DESC LIMIT ?';
  params.push(limit);

  const rows = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ ticker, insights: rows.results ?? [], total: rows.results?.length ?? 0 });
});

export { tickers };
