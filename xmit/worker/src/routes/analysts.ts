import { Hono } from 'hono';
import type { Env, Analyst, LoyaltyTier } from '../types';

const analysts = new Hono<{ Bindings: Env }>();

analysts.get('/', async (c) => {
  const module = c.req.query('module');
  const tier = c.req.query('tier');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 100);

  let query = `
    SELECT a.*,
           COUNT(i.id) as total_insights_live,
           COALESCE(SUM(i.purchase_count), 0) as total_purchases
    FROM analysts a
    LEFT JOIN insights i ON i.analyst_address = a.address
  `;
  const params: unknown[] = [];

  if (module && ['xcgo', 'xstm', 'xifd'].includes(module)) {
    query += ' WHERE i.module = ?';
    params.push(module);
  }

  query += ' GROUP BY a.address ORDER BY a.reputation_score DESC LIMIT ?';
  params.push(limit);

  const rows = await c.env.DB.prepare(query).bind(...params).all<Record<string, unknown>>();
  return c.json({ analysts: rows.results ?? [], total: rows.results?.length ?? 0 });
});

analysts.get('/:address', async (c) => {
  const address = c.req.param('address').toLowerCase();
  const row = await c.env.DB
    .prepare('SELECT * FROM analysts WHERE LOWER(address) = ?')
    .bind(address)
    .first<Record<string, unknown>>();

  if (!row) {
    return c.json({
      address,
      tier: 'CITIZEN' as LoyaltyTier,
      reputationScore: 0,
      totalInsights: 0,
      correctPredictions: 0,
      streakDays: 0,
      modules: {
        xcgo: { insightCount: 0, accuracy: 0, earnings: '0' },
        xstm: { insightCount: 0, accuracy: 0, earnings: '0' },
        xifd: { insightCount: 0, accuracy: 0, earnings: '0' },
      },
    });
  }

  const moduleStats = await c.env.DB
    .prepare('SELECT * FROM module_stats WHERE analyst_address = ?')
    .bind(row.address)
    .all<Record<string, unknown>>();

  const modules: Analyst['modules'] = {
    xcgo: { insightCount: 0, accuracy: 0, earnings: '0' },
    xstm: { insightCount: 0, accuracy: 0, earnings: '0' },
    xifd: { insightCount: 0, accuracy: 0, earnings: '0' },
  };

  for (const ms of moduleStats.results ?? []) {
    const mod = ms.module as keyof typeof modules;
    if (mod in modules) {
      const count = ms.insight_count as number;
      const correct = ms.correct_count as number;
      modules[mod] = {
        insightCount: count,
        accuracy: count > 0 ? Math.round((correct / count) * 100) : 0,
        earnings: ((ms.total_earned_micro as number) / 1_000_000).toFixed(6),
      };
    }
  }

  const recentInsights = await c.env.DB
    .prepare(`
      SELECT id, module, ticker, title, confidence_score, submitted_at, outcome_verdict
      FROM insights WHERE analyst_address = ?
      ORDER BY submitted_at DESC LIMIT 10
    `)
    .bind(row.address)
    .all();

  const achievements = await c.env.DB
    .prepare('SELECT * FROM achievements WHERE analyst_address = ? ORDER BY earned_at DESC')
    .bind(row.address)
    .all();

  return c.json({
    address: row.address,
    displayName: row.display_name,
    tier: row.tier as LoyaltyTier,
    reputationScore: row.reputation_score,
    totalInsights: row.total_insights,
    correctPredictions: row.correct_predictions,
    streakDays: row.streak_days,
    modules,
    recentInsights: recentInsights.results ?? [],
    achievements: achievements.results ?? [],
  });
});

analysts.put('/:address/profile', async (c) => {
  const address = c.req.param('address');
  let body: { displayName?: string };
  try {
    body = await c.req.json() as { displayName?: string };
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  await c.env.DB
    .prepare(`INSERT OR IGNORE INTO analysts (address) VALUES (?)`)
    .bind(address)
    .run();

  if (body.displayName) {
    await c.env.DB
      .prepare('UPDATE analysts SET display_name = ? WHERE address = ?')
      .bind(body.displayName.slice(0, 50), address)
      .run();
  }

  return c.json({ ok: true, address });
});

export { analysts };
