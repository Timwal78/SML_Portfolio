import { Hono } from 'hono';
import type { Env } from '../types';
import { XCGOModule } from '../modules/xcgo';
import { XSTMModule } from '../modules/xstm';
import { XIFDModule } from '../modules/xifd';
import { x402Gate } from '../middleware/x402';
import { randomUUID } from '../edgar/uuid';

const insights = new Hono<{ Bindings: Env }>();

insights.get('/', async (c) => {
  const module = c.req.query('module');
  const ticker = c.req.query('ticker');
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);
  const offset = (page - 1) * limit;

  let query = `
    SELECT i.id, i.analyst_address, i.module, i.ticker, i.title, i.summary,
           i.confidence_score, i.price_micro, i.submitted_at,
           i.purchase_count, i.view_count, i.outcome_verdict,
           a.reputation_score, a.tier, a.display_name
    FROM insights i
    LEFT JOIN analysts a ON a.address = i.analyst_address
    WHERE 1=1
  `;
  const params: unknown[] = [];

  if (module && ['xcgo', 'xstm', 'xifd'].includes(module)) {
    query += ' AND i.module = ?'; params.push(module);
  }
  if (ticker) {
    query += ' AND i.ticker = ?'; params.push(ticker.toUpperCase());
  }

  query += ' ORDER BY i.submitted_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ insights: rows.results ?? [], page, limit });
});

insights.get('/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB
    .prepare(`
      SELECT i.*, a.reputation_score, a.tier, a.display_name
      FROM insights i
      LEFT JOIN analysts a ON a.address = i.analyst_address
      WHERE i.id = ?
    `)
    .bind(id)
    .first<Record<string, unknown>>();

  if (!row) return c.json({ error: 'Insight not found' }, 404);

  await c.env.DB
    .prepare('UPDATE insights SET view_count = view_count + 1 WHERE id = ?')
    .bind(id)
    .run();

  const priceMicro = row.price_micro as number;
  const analystAddress = row.analyst_address as string;

  // Check if already purchased
  const payerAddress = c.req.header('X-PAYER-ADDRESS') ?? '';
  const alreadyPurchased = payerAddress
    ? !!(await c.env.DB
        .prepare('SELECT 1 FROM purchases WHERE insight_id = ? AND buyer_address = ?')
        .bind(id, payerAddress)
        .first())
    : false;

  if (priceMicro > 0 && !alreadyPurchased) {
    const gate = x402Gate({
      amountMicro: priceMicro,
      description: `xMIT Insight: ${row.title}`,
      payTo: analystAddress,
    });

    let paid = false;
    await gate(
      {
        ...c,
        req: c.req,
        env: c.env,
        json: (data: unknown, status: number) => {
          if (status === 402) return c.json(data, 402);
          paid = true;
          return c.json(data, status as 200);
        },
      } as Parameters<typeof gate>[0],
      async () => { paid = true; }
    );

    if (!paid) return;

    // Record purchase
    const txHash = c.req.header('X-PAYMENT-TX') ?? randomUUID();
    await c.env.DB
      .prepare(`
        INSERT OR IGNORE INTO purchases (id, insight_id, buyer_address, tx_hash, amount_micro)
        VALUES (?, ?, ?, ?, ?)
      `)
      .bind(randomUUID(), id, payerAddress, txHash, priceMicro)
      .run();
    await c.env.DB
      .prepare('UPDATE insights SET purchase_count = purchase_count + 1 WHERE id = ?')
      .bind(id)
      .run();
  }

  // Return full insight (evidence retrieval from R2 would go here)
  return c.json({ insight: row, fullAccess: true });
});

insights.post('/', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const { analystAddress, module, ticker, title, summary,
          confidenceScore, priceMicro, evidence } = body;

  if (!analystAddress || !module || !ticker || !title || !summary) {
    return c.json({ error: 'Missing required fields: analystAddress, module, ticker, title, summary' }, 400);
  }

  if (!['xcgo', 'xstm', 'xifd'].includes(module as string)) {
    return c.json({ error: 'module must be xcgo, xstm, or xifd' }, 400);
  }

  let insight;
  if (module === 'xcgo') {
    const xcgo = new XCGOModule(c.env);
    insight = await xcgo.submitVoteRecommendation(
      analystAddress as string,
      ticker as string,
      'VOTE_FOR',
      title as string,
      summary as string,
      (priceMicro as number) ?? 100000
    );
  } else if (module === 'xstm') {
    const xstm = new XSTMModule(c.env);
    const result = await xstm.submitThesis(
      analystAddress as string,
      ticker as string,
      title as string,
      summary as string,
      (evidence as string[]) ?? [],
      (confidenceScore as number) ?? 70,
      (priceMicro as number) ?? 200000,
      'ACCOUNTING_ANOMALY'
    );
    insight = result.insight;
  } else {
    const xifd = new XIFDModule(c.env);
    insight = await xifd.submitFlowInsight(
      analystAddress as string,
      ticker as string,
      title as string,
      summary as string,
      (priceMicro as number) ?? 100000,
      (confidenceScore as number) ?? 70
    );
  }

  return c.json({ insight }, 201);
});

export { insights };
