import { Hono } from 'hono';
import { crypto as wCrypto } from 'hono/utils/crypto';
import type { Env, FindingSeverity, FindingCategory, FilingType } from '../types/index.js';
import { awardAchievement, recalcTier } from '../reputation/engine.js';

export const findingsRouter = new Hono<{ Bindings: Env }>();

interface SubmitBody {
  ticker: string;
  auditor_address: string;
  title: string;
  summary: string;
  full_thesis: string;
  evidence_base64?: string;  // Base64 encoded evidence packet
  severity: FindingSeverity;
  category: FindingCategory;
  price_usdc: string;
  filing_accession?: string;
  filing_type?: FilingType;
}

// POST /api/v1/findings — submit forensic finding
findingsRouter.post('/', async (c) => {
  const body = await c.req.json<SubmitBody>();
  const {
    ticker, auditor_address, title, summary, full_thesis,
    evidence_base64, severity, category, price_usdc, filing_accession, filing_type,
  } = body;

  if (!ticker || !auditor_address || !title || !summary || !full_thesis || !severity || !category) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  const addr = auditor_address.toLowerCase();

  // Ensure auditor exists
  await c.env.DB.prepare(
    `INSERT INTO auditors (address) VALUES (?) ON CONFLICT(address) DO NOTHING`
  ).bind(addr).run();

  // Ensure ticker exists (create stub if needed)
  await c.env.DB.prepare(
    `INSERT INTO tickers (symbol, company_name) VALUES (?, ?) ON CONFLICT(symbol) DO NOTHING`
  ).bind(ticker.toUpperCase(), ticker.toUpperCase()).run();

  const id = crypto.randomUUID();

  // Store full thesis in R2 (encrypted by evidence hash)
  let evidenceCid: string | null = null;
  let evidenceHash: string | null = null;
  if (evidence_base64) {
    const bytes = Uint8Array.from(atob(evidence_base64), c => c.charCodeAt(0));
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    evidenceHash = '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    evidenceCid = `xaap-evidence/${id}`;
    await c.env.EVIDENCE.put(evidenceCid, bytes, {
      httpMetadata: { contentType: 'application/octet-stream' },
      customMetadata: { finding_id: id, evidence_hash: evidenceHash },
    });
  }

  // Store full thesis text in R2
  await c.env.EVIDENCE.put(`xaap-thesis/${id}`, full_thesis, {
    httpMetadata: { contentType: 'text/plain' },
  });

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    `INSERT INTO findings
       (id, ticker, auditor_address, title, summary, evidence_cid, evidence_hash,
        severity, category, price_usdc, status, filing_accession, filing_type,
        created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,'PENDING',?,?,?,?)`
  ).bind(
    id, ticker.toUpperCase(), addr, title, summary,
    evidenceCid, evidenceHash, severity, category, price_usdc,
    filing_accession ?? null, filing_type ?? null, now, now
  ).run();

  // Update auditor stats
  await c.env.DB.prepare(
    `UPDATE auditors SET total_findings = total_findings + 1, last_active = ? WHERE address = ?`
  ).bind(now, addr).run();

  // Award FIRST_BLOOD if this is their first finding
  const auditor = await c.env.DB.prepare(
    'SELECT total_findings FROM auditors WHERE address = ?'
  ).bind(addr).first<{ total_findings: number }>();
  if ((auditor?.total_findings ?? 0) === 1) {
    await awardAchievement(c.env.DB, addr, 'FIRST_BLOOD');
  }

  // Recalculate tier
  await recalcTier(c.env.DB, addr);

  // Discord notification (fire-and-forget)
  if (c.env.DISCORD_WEBHOOK_FINDINGS) {
    c.executionCtx.waitUntil(notifyDiscord(c.env.DISCORD_WEBHOOK_FINDINGS, {
      ticker: ticker.toUpperCase(), title, severity, auditor_address: addr, id,
    }));
  }

  return c.json({ id, status: 'PENDING', message: 'Finding submitted for jury review' }, 201);
});

// GET /api/v1/findings/:id — single finding (full thesis requires x402)
findingsRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const payment = c.req.header('X-Payment');

  const finding = await c.env.DB.prepare(
    `SELECT f.*, a.reputation_score, a.tier, a.display_name
     FROM findings f JOIN auditors a ON f.auditor_address = a.address
     WHERE f.id = ?`
  ).bind(id).first<Record<string, unknown>>();

  if (!finding) return c.json({ error: 'Finding not found' }, 404);

  const priceUsdc = String(finding['price_usdc']);

  if (!payment) {
    // Return summary only, gate full thesis
    const { full_thesis: _, ...publicFinding } = finding;
    return c.json({
      ...publicFinding,
      full_thesis: null,
      requires_payment: true,
      x402: {
        x402Version: 1,
        accepts: [{
          scheme: 'exact', network: 'base-mainnet',
          maxAmountRequired: priceUsdc,
          resource: `/api/v1/findings/${id}`,
          description: `Full forensic thesis: ${finding['title']}`,
          mimeType: 'application/json',
          payTo: c.env.MERCHANT_WALLET_ADDRESS,
          maxTimeoutSeconds: 300,
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          extra: { name: 'USDC', version: '3' },
        }],
      },
    });
  }

  // Fetch full thesis from R2
  const thesisObj = await c.env.EVIDENCE.get(`xaap-thesis/${id}`);
  const fullThesis = thesisObj ? await thesisObj.text() : null;

  // Log purchase
  const buyerAddr = c.req.header('X-Wallet-Address') ?? 'unknown';
  const feeBps = Number(c.env.PROTOCOL_FEE_BPS);
  const amount = BigInt(priceUsdc);
  const protocolFee = amount * BigInt(feeBps) / 10000n;
  const auditorPayout = amount - protocolFee;
  const agentId = c.req.header('X-Agent-Id');
  const agentPayout = agentId ? protocolFee * 15n / 100n : 0n;

  await c.env.DB.prepare(
    `INSERT INTO purchases (id, finding_id, buyer_address, amount_usdc, auditor_payout, juror_payout, treasury_payout, agent_payout, agent_id, payment_proof)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    crypto.randomUUID(), id, buyerAddr, priceUsdc,
    String(auditorPayout), String(protocolFee * 20n / 100n),
    String(protocolFee * 5n / 100n), String(agentPayout),
    agentId ?? null, payment
  ).run();

  // Increment access count
  await c.env.DB.prepare(
    'UPDATE findings SET access_count = access_count + 1 WHERE id = ?'
  ).bind(id).run();

  return c.json({ ...finding, full_thesis: fullThesis });
});

async function notifyDiscord(webhookUrl: string, data: {
  ticker: string; title: string; severity: string; auditor_address: string; id: string;
}) {
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        title: `🚨 New Finding: ${data.ticker}`,
        description: data.title,
        color: data.severity === 'CRITICAL' ? 0xff0000 : data.severity === 'HIGH' ? 0xff8800 : 0xffcc00,
        fields: [
          { name: 'Severity', value: data.severity, inline: true },
          { name: 'Auditor', value: `${data.auditor_address.slice(0, 8)}...`, inline: true },
        ],
        footer: { text: `ID: ${data.id}` },
      }],
    }),
  });
}
