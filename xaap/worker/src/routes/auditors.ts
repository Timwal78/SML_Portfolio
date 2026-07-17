import { Hono } from 'hono';
import type { Env } from '../types/index.js';

export const auditorsRouter = new Hono<{ Bindings: Env }>();

// GET /api/v1/auditors — global leaderboard (free)
auditorsRouter.get('/', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const offset = Number(c.req.query('offset') ?? 0);
  const tier = c.req.query('tier');

  let query = `SELECT address, display_name, ens_name, tier, reputation_score,
                      accuracy_rate, total_findings, validated_findings, streak_days,
                      total_earned_usdc, created_at
               FROM auditors`;
  const params: unknown[] = [];
  if (tier) { query += ' WHERE tier = ?'; params.push(tier); }
  query += ' ORDER BY reputation_score DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const result = await c.env.DB.prepare(query).bind(...params).all();
  const total = await c.env.DB.prepare('SELECT COUNT(*) as n FROM auditors').first<{ n: number }>();

  return c.json({ auditors: result.results, total: total?.n ?? 0 });
});

// GET /api/v1/auditors/:address — auditor profile (free)
auditorsRouter.get('/:address', async (c) => {
  const address = c.req.param('address').toLowerCase();
  const auditor = await c.env.DB.prepare(
    `SELECT * FROM auditors WHERE address = ?`
  ).bind(address).first();
  if (!auditor) return c.json({ error: 'Auditor not found' }, 404);

  const [findings, achievements, recentEvents] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, ticker, title, severity, status, created_at
       FROM findings WHERE auditor_address = ?
       ORDER BY created_at DESC LIMIT 20`
    ).bind(address).all(),
    c.env.DB.prepare(
      `SELECT badge_id, earned_at FROM achievements WHERE auditor_address = ?`
    ).bind(address).all(),
    c.env.DB.prepare(
      `SELECT event_type, delta, multiplier, note, created_at
       FROM reputation_events WHERE auditor_address = ?
       ORDER BY created_at DESC LIMIT 10`
    ).bind(address).all(),
  ]);

  return c.json({
    ...auditor,
    recent_findings: findings.results,
    achievements: achievements.results,
    reputation_history: recentEvents.results,
  });
});

// POST /api/v1/auditors/register — register or update auditor
auditorsRouter.post('/register', async (c) => {
  const body = await c.req.json<{
    address: string; display_name?: string; bio?: string; referrer_address?: string;
  }>();
  const addr = body.address?.toLowerCase();
  if (!addr) return c.json({ error: 'address required' }, 400);

  await c.env.DB.prepare(
    `INSERT INTO auditors (address, display_name, bio, referrer_address)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(address) DO UPDATE SET
       display_name = COALESCE(excluded.display_name, display_name),
       bio = COALESCE(excluded.bio, bio)`
  ).bind(addr, body.display_name ?? null, body.bio ?? null, body.referrer_address?.toLowerCase() ?? null).run();

  const auditor = await c.env.DB.prepare('SELECT * FROM auditors WHERE address = ?').bind(addr).first();
  return c.json(auditor, 201);
});
