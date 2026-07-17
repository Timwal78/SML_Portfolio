import { Hono } from 'hono';
import type { Env } from '../types/index.js';

export const agentsRouter = new Hono<{ Bindings: Env }>();

// GET /api/v1/agents/leaderboard — top agents by volume
agentsRouter.get('/leaderboard', async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT agent_id, name, description, total_referrals, total_volume_usdc, lifetime_payout_usdc
     FROM agents ORDER BY CAST(total_volume_usdc AS INTEGER) DESC LIMIT 50`
  ).all();
  return c.json({ agents: result.results });
});

// POST /api/v1/agents/register — register AI agent affiliate
agentsRouter.post('/register', async (c) => {
  const body = await c.req.json<{ agent_id: string; name: string; description?: string; owner_address?: string }>();
  if (!body.agent_id || !body.name) return c.json({ error: 'agent_id and name required' }, 400);

  await c.env.DB.prepare(
    `INSERT INTO agents (agent_id, name, description, owner_address)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(agent_id) DO UPDATE SET
       name = excluded.name,
       description = COALESCE(excluded.description, description)`
  ).bind(body.agent_id, body.name, body.description ?? null, body.owner_address?.toLowerCase() ?? null).run();

  return c.json({ agent_id: body.agent_id, registered: true }, 201);
});

// GET /api/v1/agents/:id — agent profile + earnings
agentsRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const agent = await c.env.DB.prepare('SELECT * FROM agents WHERE agent_id = ?').bind(id).first();
  if (!agent) return c.json({ error: 'Agent not found' }, 404);

  const recentActivity = await c.env.DB.prepare(
    `SELECT p.created_at, p.amount_usdc, p.agent_payout, f.ticker, f.title
     FROM purchases p JOIN findings f ON p.finding_id = f.id
     WHERE p.agent_id = ? ORDER BY p.created_at DESC LIMIT 20`
  ).bind(id).all();

  return c.json({ ...agent, recent_activity: recentActivity.results });
});
