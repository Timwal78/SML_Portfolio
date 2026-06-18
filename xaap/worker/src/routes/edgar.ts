import { Hono } from 'hono';
import type { Env } from '../types/index.js';

export const edgarRouter = new Hono<{ Bindings: Env }>();

// GET /api/v1/edgar/recent — recently processed filings
edgarRouter.get('/recent', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 20), 100);
  const formType = c.req.query('form_type');
  const ticker = c.req.query('ticker');

  let query = `SELECT accession_number, cik, ticker, form_type, filing_date,
                      processing_status, forensic_score, red_flags_json, processed_at
               FROM filings`;
  const params: unknown[] = [];
  const where: string[] = [];
  if (formType) { where.push('form_type = ?'); params.push(formType); }
  if (ticker) { where.push('ticker = ?'); params.push(ticker.toUpperCase()); }
  if (where.length) query += ' WHERE ' + where.join(' AND ');
  query += ' ORDER BY filing_date DESC LIMIT ?';
  params.push(limit);

  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ filings: result.results });
});

// GET /api/v1/edgar/verdict/:accession — verdict for a specific filing
edgarRouter.get('/verdict/:accession', async (c) => {
  const accession = c.req.param('accession');
  const filing = await c.env.DB.prepare(
    'SELECT * FROM filings WHERE accession_number = ?'
  ).bind(accession).first();
  if (!filing) return c.json({ error: 'Filing not found' }, 404);

  const relatedFindings = await c.env.DB.prepare(
    `SELECT f.*, a.reputation_score, a.tier
     FROM findings f JOIN auditors a ON f.auditor_address = a.address
     WHERE f.filing_accession = ?`
  ).bind(accession).all();

  return c.json({ filing, related_findings: relatedFindings.results });
});
