import { Hono } from 'hono';
import type { Env } from '../types/index.js';

export const tickersRouter = new Hono<{ Bindings: Env }>();

// GET /api/v1/tickers — list all covered tickers
tickerRouter.get('/', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const offset = Number(c.req.query('offset') ?? 0);
  const grade = c.req.query('grade');
  const sector = c.req.query('sector');

  let query = 'SELECT * FROM tickers';
  const params: unknown[] = [];
  const where: string[] = [];

  if (grade) { where.push('health_grade = ?'); params.push(grade); }
  if (sector) { where.push('sector = ?'); params.push(sector); }
  if (where.length) query += ' WHERE ' + where.join(' AND ');
  query += ' ORDER BY red_flag_count DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const result = await c.env.DB.prepare(query).bind(...params).all();
  const total = await c.env.DB.prepare('SELECT COUNT(*) as n FROM tickers').first<{ n: number }>();

  c.header('X-Auditor-Count', String(total?.n ?? 0));
  return c.json({ tickers: result.results, total: total?.n ?? 0, limit, offset });
});

// GET /api/v1/tickers/:symbol — ticker detail + health score (free)
tickerRouter.get('/:symbol', async (c) => {
  const symbol = c.req.param('symbol').toUpperCase();
  const ticker = await c.env.DB.prepare('SELECT * FROM tickers WHERE symbol = ?').bind(symbol).first();
  if (!ticker) return c.json({ error: 'Ticker not found' }, 404);

  // Free top-3 findings (time-delayed 48h)
  const cutoff = Math.floor(Date.now() / 1000) - Number(c.env.FREE_DELAY_HOURS) * 3600;
  const freefindings = await c.env.DB.prepare(
    `SELECT id, title, summary, severity, category, created_at
     FROM findings
     WHERE ticker = ? AND status = 'VALIDATED' AND created_at <= ?
     ORDER BY severity DESC, created_at DESC
     LIMIT 3`
  ).bind(symbol, cutoff).all();

  return c.json({
    ...ticker,
    free_findings: freefindings.results,
    cost_per_finding_usdc: 0.01,
    disclaimer: 'Free findings are 48h delayed. Real-time access via x402 payment.',
  });
});

// GET /api/v1/tickers/:symbol/findings — all findings (x402 gated)
tickerRouter.get('/:symbol/findings', async (c) => {
  const payment = c.req.header('X-Payment');
  const symbol = c.req.param('symbol').toUpperCase();
  const ticker = await c.env.DB.prepare('SELECT symbol FROM tickers WHERE symbol = ?').bind(symbol).first();
  if (!ticker) return c.json({ error: 'Ticker not found' }, 404);

  if (!payment) {
    return c.json({
      x402Version: 1,
      error: 'Payment required for real-time findings',
      accepts: [{
        scheme: 'exact',
        network: 'base-mainnet',
        maxAmountRequired: '10000',  // $0.01
        resource: `/api/v1/tickers/${symbol}/findings`,
        description: `Forensic findings for ${symbol}`,
        mimeType: 'application/json',
        payTo: c.env.MERCHANT_WALLET_ADDRESS,
        maxTimeoutSeconds: 300,
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        extra: { name: 'USDC', version: '3' },
      }],
    }, 402);
  }

  const severity = c.req.query('severity');
  const category = c.req.query('category');
  let query = `SELECT f.*, a.reputation_score, a.tier, a.accuracy_rate
               FROM findings f JOIN auditors a ON f.auditor_address = a.address
               WHERE f.ticker = ?`;
  const params: unknown[] = [symbol];
  if (severity) { query += ' AND f.severity = ?'; params.push(severity); }
  if (category) { query += ' AND f.category = ?'; params.push(category); }
  query += ' ORDER BY f.severity DESC, a.reputation_score DESC, f.created_at DESC';

  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({
    ticker: symbol,
    findings: result.results,
    count: result.results.length,
  });
});

// GET /api/v1/tickers/:symbol/redflags — red flag summary count (x402: $0.01)
tickerRouter.get('/:symbol/redflags', async (c) => {
  const payment = c.req.header('X-Payment');
  const symbol = c.req.param('symbol').toUpperCase();

  if (!payment) {
    return c.json({
      x402Version: 1, error: 'Payment required',
      accepts: [{ scheme: 'exact', network: 'base-mainnet', maxAmountRequired: '10000',
        resource: `/api/v1/tickers/${symbol}/redflags`,
        description: `Red flag detail for ${symbol}`,
        mimeType: 'application/json', payTo: c.env.MERCHANT_WALLET_ADDRESS,
        maxTimeoutSeconds: 300, asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        extra: { name: 'USDC', version: '3' } }],
    }, 402);
  }

  const rows = await c.env.DB.prepare(
    `SELECT category, severity, COUNT(*) as count
     FROM findings WHERE ticker = ? AND status = 'VALIDATED'
     GROUP BY category, severity ORDER BY count DESC`
  ).bind(symbol).all();

  return c.json({ ticker: symbol, breakdown: rows.results });
});

const tickerRouter = tickersRouter;
