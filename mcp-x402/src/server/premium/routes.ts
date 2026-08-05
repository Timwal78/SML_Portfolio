/**
 * Premium Index Match API — hosted on mcp-x402 ($0 new burn).
 *
 * Operator / bypass keys → FREE unlimited (you own the stack).
 * Customer keys pidx_* → metered Starter 100k / Pro 1M.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Express, NextFunction, Request, Response } from 'express';
import { getCachedBeacons, getLiveAmbDocument } from '../amb/amb-routes.js';
import { SAFE_PAY_TO, type AgentMagnetBeacon } from '../amb/amb-generator.js';
import { IMP_VERSION } from '../amb/imp-scoring.js';
import { AuditLogger } from '../security/audit.js';

export const PREMIUM_API_VERSION = '0.1.0';

export const PLANS: Record<
  string,
  {
    name: string;
    price_usd_month: number | null;
    match_limit: number;
    rpm: number;
    priority: boolean;
    features: string[];
  }
> = {
  starter: {
    name: 'Starter Hosted',
    price_usd_month: 49,
    match_limit: 100_000,
    rpm: 60,
    priority: false,
    features: ['hosted_match', 'usage', 'standard_rank'],
  },
  pro: {
    name: 'Pro Provider',
    price_usd_month: 199,
    match_limit: 1_000_000,
    rpm: 240,
    priority: true,
    features: ['hosted_match', 'usage', 'priority_ranking', 'higher_rpm'],
  },
  enterprise: {
    name: 'Enterprise / Federal',
    price_usd_month: null,
    match_limit: Number(process.env['PREMIUM_ENTERPRISE_LIMIT'] || 5_000_000),
    rpm: 600,
    priority: true,
    features: ['hosted_match', 'private_index', 'sla', 'sdvosb'],
  },
  operator: {
    name: 'Operator (free)',
    price_usd_month: 0,
    match_limit: Number.MAX_SAFE_INTEGER,
    rpm: 10_000,
    priority: true,
    features: ['unlimited', 'admin', 'free'],
  },
};

type KeyRec = {
  plan: string;
  label: string;
  created_at: string;
  active: boolean;
  key_prefix: string;
};

type StoreFile = {
  keys: Record<string, KeyRec>;
  usage: Record<string, { matches: number; last_at?: string }>;
};

const rpmBuckets = new Map<string, number[]>();

function meterPath(): string {
  return (
    process.env['PREMIUM_METER_FILE'] ||
    process.env['X402_STATS_FILE']?.replace(/[^/]+$/, 'premium-meter.json') ||
    '/tmp/premium-meter.json'
  );
}

function utcMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function monthResetIso(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const next = m === 11 ? new Date(Date.UTC(y + 1, 0, 1)) : new Date(Date.UTC(y, m + 1, 1));
  return next.toISOString();
}

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function safeEq(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  try {
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function readStore(): StoreFile {
  const p = meterPath();
  try {
    if (!existsSync(p)) return { keys: {}, usage: {} };
    const j = JSON.parse(readFileSync(p, 'utf8')) as StoreFile;
    return { keys: j.keys || {}, usage: j.usage || {} };
  } catch {
    return { keys: {}, usage: {} };
  }
}

function writeStore(data: StoreFile): void {
  const p = meterPath();
  try {
    mkdirSync(dirname(p), { recursive: true });
  } catch {
    /* */
  }
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

function newApiKey(): string {
  return `pidx_${randomBytes(18).toString('base64url')}`;
}

export function mintPremiumKey(plan: string, label = ''): {
  api_key: string;
  plan: string;
  label: string;
  match_limit: number;
  note: string;
} {
  const p = plan.toLowerCase().trim();
  if (!PLANS[p] || p === 'operator') throw new Error(`invalid plan: ${plan}`);
  const raw = newApiKey();
  const h = hashKey(raw);
  const data = readStore();
  data.keys[h] = {
    plan: p,
    label: label || p,
    created_at: new Date().toISOString(),
    active: true,
    key_prefix: `${raw.slice(0, 10)}…`,
  };
  writeStore(data);
  return {
    api_key: raw,
    plan: p,
    label: label || p,
    match_limit: PLANS[p]!.match_limit,
    note: 'Store this key now — only the hash is retained. Operator keys stay free unlimited.',
  };
}

function usageFor(keyHash: string, plan: string) {
  const month = utcMonth();
  const ukey = `${keyHash}:${month}`;
  const used = Number(readStore().usage[ukey]?.matches || 0);
  const limit = PLANS[plan]?.match_limit ?? PLANS.starter!.match_limit;
  const remaining = plan === 'operator' ? limit : Math.max(0, limit - used);
  return { month, used, limit, remaining, reset: monthResetIso(), plan };
}

function consumeMatch(keyHash: string, plan: string) {
  if (plan === 'operator') {
    // free — still stamp rpm lightly but no quota burn
    const arr = rpmBuckets.get(keyHash) || [];
    arr.push(Date.now());
    rpmBuckets.set(keyHash, arr.filter((t) => Date.now() - t < 60_000));
    return usageFor(keyHash, plan);
  }
  const month = utcMonth();
  const ukey = `${keyHash}:${month}`;
  const data = readStore();
  const row = data.usage[ukey] || { matches: 0 };
  row.matches = Number(row.matches || 0) + 1;
  row.last_at = new Date().toISOString();
  data.usage[ukey] = row;
  writeStore(data);
  const arr = rpmBuckets.get(keyHash) || [];
  arr.push(Date.now());
  rpmBuckets.set(keyHash, arr.filter((t) => Date.now() - t < 60_000));
  return usageFor(keyHash, plan);
}

function checkRpm(keyHash: string, plan: string): { ok: boolean; rpm: number } {
  const rpm = PLANS[plan]?.rpm ?? 60;
  const window = (rpmBuckets.get(keyHash) || []).filter((t) => Date.now() - t < 60_000);
  rpmBuckets.set(keyHash, window);
  return { ok: window.length < rpm, rpm };
}

type AuthRec = {
  plan: string;
  label: string;
  keyHash: string;
  isOperator: boolean;
  free: boolean;
};

/** Operator free path + customer pidx_ keys. */
export function resolvePremiumAuth(req: Request): AuthRec | null {
  const opKey = (process.env['SML_API_KEY'] || '').trim();
  const premiumOp = (process.env['PREMIUM_OPERATOR_KEY'] || '').trim();
  const acpBypass = (
    process.env['SML_ACP_BYPASS_SECRET'] ||
    process.env['LEVIATHAN_BYPASS_SECRET'] ||
    ''
  ).trim();

  const headerKey =
    (req.headers['x-api-key'] as string | undefined)?.trim() ||
    (req.headers['x-operator-key'] as string | undefined)?.trim() ||
    (req.headers['x-sml-acp-key'] as string | undefined)?.trim() ||
    (req.headers['x-leviathan-key'] as string | undefined)?.trim() ||
    '';

  let bearer = '';
  const auth = (req.headers.authorization || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) bearer = auth.slice(7).trim();

  const candidates = [headerKey, bearer].filter(Boolean);

  for (const c of candidates) {
    if (opKey && safeEq(c, opKey)) {
      return {
        plan: 'operator',
        label: 'operator',
        keyHash: hashKey(c),
        isOperator: true,
        free: true,
      };
    }
    if (premiumOp && safeEq(c, premiumOp)) {
      return {
        plan: 'operator',
        label: 'premium-operator',
        keyHash: hashKey(c),
        isOperator: true,
        free: true,
      };
    }
    if (acpBypass && safeEq(c, acpBypass)) {
      return {
        plan: 'operator',
        label: 'acp-bypass',
        keyHash: hashKey(c),
        isOperator: true,
        free: true,
      };
    }
    if (c.startsWith('pidx_')) {
      const h = hashKey(c);
      const rec = readStore().keys[h];
      if (rec?.active) {
        return {
          plan: rec.plan,
          label: rec.label || rec.plan,
          keyHash: h,
          isOperator: false,
          free: false,
        };
      }
    }
  }
  return null;
}

const TOKEN_RE = /[a-z0-9_]+/gi;

function tokenize(q: string): string[] {
  return (q.match(TOKEN_RE) || []).map((t) => t.toLowerCase()).filter((t) => t.length > 1);
}

function blob(b: AgentMagnetBeacon | Record<string, unknown>): string {
  const caps = Array.isArray(b.capabilities) ? b.capabilities.join(' ') : '';
  return [b.tool_name, b.namespace, b.description, caps].map(String).join(' ').toLowerCase();
}

function textScore(tokens: string[], b: AgentMagnetBeacon | Record<string, unknown>): number {
  if (!tokens.length) return 1;
  const bl = blob(b);
  const hits = tokens.filter((t) => bl.includes(t)).length;
  return hits / tokens.length;
}

function finalScore(
  b: AgentMagnetBeacon | Record<string, unknown>,
  tscore: number,
  priority: boolean,
): number {
  const imp = Number(
    (b as { imp_score?: number }).imp_score ?? (b as { magnet_strength?: number }).magnet_strength ?? 0,
  );
  let score = imp * 0.75 + tscore * 0.25;
  if (priority) {
    const issuer = String((b as { issuer?: string }).issuer || '');
    const agent = (b as { agent?: { name?: string } }).agent;
    if (issuer.toLowerCase().includes('scriptmasterlabs') || agent?.name === 'scriptmasterlabs') {
      score += 0.02;
    }
  }
  return Math.round(Math.max(0, Math.min(1, score)) * 1e6) / 1e6;
}

export function matchBeacons(
  beacons: Array<AgentMagnetBeacon | Record<string, unknown>>,
  opts: {
    q?: string;
    limit?: number;
    min_imp_score?: number | null;
    namespace_prefix?: string | null;
    rails?: string[] | null;
    include_free?: boolean;
    priority?: boolean;
  },
): Record<string, unknown>[] {
  const tokens = tokenize(opts.q || '');
  const limit = Math.max(1, Math.min(Number(opts.limit || 10), 100));
  const required = new Set((opts.rails || []).map((r) => r.toLowerCase()));
  const out: Record<string, unknown>[] = [];

  for (const b of beacons) {
    const free = Boolean((b as { free_tier?: boolean }).free_tier);
    if (opts.include_free === false && free) continue;
    const imp = Number(
      (b as { imp_score?: number }).imp_score ?? (b as { magnet_strength?: number }).magnet_strength ?? 0,
    );
    if (opts.min_imp_score != null && imp < Number(opts.min_imp_score)) continue;
    const ns = String((b as { namespace?: string }).namespace || '');
    if (opts.namespace_prefix && !ns.toLowerCase().startsWith(String(opts.namespace_prefix).toLowerCase())) {
      continue;
    }
    const payment = (b as { payment?: Record<string, unknown> }).payment || {};
    const advertised = [
      ...((payment.rails as string[]) || []),
      ...(((payment.rail_detail as Array<{ id?: string }>) || []).map((r) => r.id || '')),
    ]
      .filter(Boolean)
      .map((x) => String(x).toLowerCase());
    if (required.size && advertised.length) {
      let ok = true;
      for (const r of required) {
        if (!advertised.includes(r)) ok = false;
      }
      if (!ok) continue;
    }

    const ts = textScore(tokens, b);
    if (tokens.length && ts <= 0) continue;
    const fs = finalScore(b, ts, Boolean(opts.priority));
    const reasons: string[] = [];
    if (tokens.length) {
      const bl = blob(b);
      for (const t of tokens) if (bl.includes(t)) reasons.push(`token:${t}`);
    }
    reasons.push('imp_score');
    if (opts.priority) reasons.push('priority_plan');

    const payTo =
      String(
        (b as { pay_to?: string }).pay_to ||
          payment.pay_to ||
          SAFE_PAY_TO,
      ) || SAFE_PAY_TO;
    const safePay = payTo.toLowerCase().startsWith('0x4e14') ? SAFE_PAY_TO : payTo;

    out.push({
      tool_name: (b as { tool_name?: string }).tool_name,
      namespace: (b as { namespace?: string }).namespace,
      description: (b as { description?: string }).description,
      endpoint: (b as { endpoint?: string }).endpoint,
      price: payment.price || (free ? '0' : '0.001'),
      free_tier: free,
      imp_score: imp,
      magnet_strength: Number((b as { magnet_strength?: number }).magnet_strength ?? imp),
      rail_score: (b as { rail_score?: number }).rail_score,
      rail_coverage: (b as { rail_coverage?: number }).rail_coverage,
      match_score: fs,
      text_score: Math.round(ts * 10000) / 10000,
      pay_to: safePay,
      rails: payment.rails,
      capabilities: (b as { capabilities?: string[] }).capabilities,
      match_reasons: reasons,
    });
  }

  out.sort(
    (a, b) =>
      Number(b.match_score) - Number(a.match_score) || Number(b.imp_score) - Number(a.imp_score),
  );
  return out.slice(0, limit);
}

function requireAuth(req: Request, res: Response): AuthRec | null {
  const rec = resolvePremiumAuth(req);
  if (!rec) {
    res.status(401).set('Access-Control-Allow-Origin', '*').json({
      ok: false,
      error: 'unauthorized',
      hint: 'X-Api-Key: pidx_… (paid) or X-Operator-Key / operator secret (free unlimited for you)',
      pricing: 'https://www.scriptmasterlabs.com/pricing.html',
    });
    return null;
  }
  return rec;
}

function gateQuota(rec: AuthRec, res: Response): boolean {
  if (rec.free || rec.plan === 'operator') return true;
  const usage = usageFor(rec.keyHash, rec.plan);
  if (usage.used >= usage.limit) {
    res.status(429).set('Access-Control-Allow-Origin', '*').json({
      ok: false,
      error: 'quota_exceeded',
      ...usage,
    });
    return false;
  }
  const rpm = checkRpm(rec.keyHash, rec.plan);
  if (!rpm.ok) {
    res.status(429).set('Access-Control-Allow-Origin', '*').json({
      ok: false,
      error: 'rate_limit_exceeded',
      rpm: rpm.rpm,
      retry_after: 60,
    });
    return false;
  }
  return true;
}

export function mountPremiumIndexRoutes(app: Express): void {
  app.get('/v1/health', (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*').json({
      ok: true,
      service: 'premium-index',
      version: PREMIUM_API_VERSION,
      imp_version: IMP_VERSION,
      pay_to: SAFE_PAY_TO,
      operator_free: true,
      note: 'Operator keys unlimited free; customers use pidx_ keys (Starter/Pro).',
    });
  });

  app.get('/v1/plans', (_req, res) => {
    const publicPlans: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(PLANS)) {
      if (k === 'operator') continue;
      publicPlans[k] = {
        name: v.name,
        price_usd_month: v.price_usd_month,
        match_limit: v.match_limit,
        rpm: v.rpm,
        priority: v.priority,
        features: v.features,
      };
    }
    res.set('Access-Control-Allow-Origin', '*').json({
      ok: true,
      plans: publicPlans,
      operator: { free: true, note: 'X-Operator-Key / SML operator secrets — unlimited, not billed' },
      pricing: 'https://www.scriptmasterlabs.com/pricing.html',
      match: 'https://mcp-x402.onrender.com/v1/match',
    });
  });

  app.get('/v1/openapi.json', (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*').json({
      openapi: '3.0.3',
      info: {
        title: 'Script Master Labs Premium Index Match API',
        version: PREMIUM_API_VERSION,
        description:
          'Hosted Capability Index. Operator keys free unlimited. Customers: X-Api-Key pidx_… Starter $49 / Pro $199.',
      },
      servers: [{ url: 'https://mcp-x402.onrender.com' }],
      paths: {
        '/v1/match': { post: { summary: 'Match capabilities (billable for pidx_ keys)' } },
        '/v1/usage': { get: { summary: 'Usage' } },
        '/v1/plans': { get: { summary: 'Plans' } },
        '/v1/health': { get: { summary: 'Health' } },
      },
      components: {
        securitySchemes: {
          ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
          OperatorKey: { type: 'apiKey', in: 'header', name: 'X-Operator-Key' },
        },
      },
    });
  });

  app.get('/v1/usage', (req, res) => {
    const rec = requireAuth(req, res);
    if (!rec) return;
    const usage = usageFor(rec.keyHash, rec.plan);
    res.set('Access-Control-Allow-Origin', '*').json({
      ok: true,
      label: rec.label,
      free: rec.free,
      ...usage,
    });
  });

  app.post('/v1/match', (req, res) => {
    const rec = requireAuth(req, res);
    if (!rec) return;
    if (!gateQuota(rec, res)) return;

    const body = (req.body || {}) as Record<string, unknown>;
    const q = String(body.q || body.query || '');
    const limit = Number(body.limit || 10);
    const minImp = body.min_imp_score != null ? Number(body.min_imp_score) : null;
    const ns = body.namespace_prefix != null ? String(body.namespace_prefix) : null;
    let rails = body.rails as string[] | string | null | undefined;
    if (typeof rails === 'string') rails = rails.split(',').map((s) => s.trim()).filter(Boolean);
    const includeFree = body.include_free === undefined ? true : Boolean(body.include_free);
    const priority = Boolean(PLANS[rec.plan]?.priority);

    const beacons = getCachedBeacons();
    const results = matchBeacons(beacons, {
      q,
      limit,
      min_imp_score: minImp,
      namespace_prefix: ns,
      rails: Array.isArray(rails) ? rails : null,
      include_free: includeFree,
      priority,
    });

    const usage = consumeMatch(rec.keyHash, rec.plan);
    try {
      AuditLogger.getInstance().info('premium_match', {
        plan: rec.plan,
        free: rec.free,
        matched: results.length,
        q: q.slice(0, 80),
      });
    } catch {
      /* */
    }

    res.set('Access-Control-Allow-Origin', '*').json({
      ok: true,
      plan: rec.plan,
      free: rec.free,
      matched: results.length,
      query: q,
      imp_version: IMP_VERSION,
      ranking:
        'imp_score*0.75 + text_score*0.25' + (priority ? ' + pro_priority' : '') + (rec.free ? ' (operator free)' : ''),
      pay_to: SAFE_PAY_TO,
      usage,
      results,
    });
  });

  app.get('/v1/beacons', (req, res) => {
    const rec = requireAuth(req, res);
    if (!rec) return;
    if (!gateQuota(rec, res)) return;

    const limit = Number(req.query.limit || 25);
    const minImp =
      req.query.min_imp_score != null ? Number(req.query.min_imp_score) : null;
    const priority = Boolean(PLANS[rec.plan]?.priority);
    const results = matchBeacons(getCachedBeacons(), {
      q: '',
      limit,
      min_imp_score: minImp,
      include_free: true,
      priority,
    });
    const usage = consumeMatch(rec.keyHash, rec.plan);
    res.set('Access-Control-Allow-Origin', '*').json({
      ok: true,
      plan: rec.plan,
      free: rec.free,
      count: results.length,
      pay_to: SAFE_PAY_TO,
      imp_version: IMP_VERSION,
      usage,
      results,
    });
  });

  app.post('/v1/admin/keys', (req, res) => {
    const rec = requireAuth(req, res);
    if (!rec) return;
    if (!rec.isOperator) {
      res.status(403).set('Access-Control-Allow-Origin', '*').json({ ok: false, error: 'forbidden' });
      return;
    }
    const plan = String((req.body || {}).plan || 'starter');
    const label = String((req.body || {}).label || '');
    try {
      const minted = mintPremiumKey(plan, label);
      res.set('Access-Control-Allow-Origin', '*').json({ ok: true, ...minted });
    } catch (e) {
      res.status(400).set('Access-Control-Allow-Origin', '*').json({ ok: false, error: String(e) });
    }
  });

  app.get('/v1/admin/usage', (req, res) => {
    const rec = requireAuth(req, res);
    if (!rec) return;
    if (!rec.isOperator) {
      res.status(403).set('Access-Control-Allow-Origin', '*').json({ ok: false, error: 'forbidden' });
      return;
    }
    const data = readStore();
    const keys = Object.entries(data.keys).map(([h, k]) => ({
      ...k,
      key_hash_prefix: h.slice(0, 12),
      usage: usageFor(h, k.plan),
    }));
    res.set('Access-Control-Allow-Origin', '*').json({ ok: true, keys, meter_file: meterPath() });
  });

  // Lightweight discovery hint on live AMB doc consumers
  app.get('/v1', (_req, res) => {
    const doc = getLiveAmbDocument();
    res.set('Access-Control-Allow-Origin', '*').json({
      ok: true,
      service: 'premium-index',
      version: PREMIUM_API_VERSION,
      endpoints: {
        health: '/v1/health',
        plans: '/v1/plans',
        match: 'POST /v1/match',
        usage: '/v1/usage',
        beacons: '/v1/beacons',
        openapi: '/v1/openapi.json',
      },
      operator_free: true,
      pay_to: SAFE_PAY_TO,
      amb_count: doc.count,
      pricing: 'https://www.scriptmasterlabs.com/pricing.html',
    });
  });

  // eslint-disable-next-line no-console
  console.log('[premium-index] mounted /v1/* Match API (operator free, pidx_ metered)');
}

/** Optional middleware noop export for tests */
export function premiumCors(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
}
