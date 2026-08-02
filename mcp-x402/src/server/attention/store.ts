/**
 * Attention Broker — crawler-of-crawlers + pay-for-verified-attention.
 * Durable via REDIS_URL (same pattern as x402-stats) with local JSON fallback.
 * Boot reseeds SML open reindex bounties so the job board survives deploys.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createClient, type RedisClientType } from 'redis';

const REDIS_KEY = 'attention-broker:v1';
const MAX_BOUNTIES = 500;

export type AttentionTargetKind = 'index' | 'router' | 'board' | 'manifest' | 'unknown';

export interface AttentionTarget {
  id: string;
  origin: string;
  kind: AttentionTargetKind;
  name?: string;
  endpoints: string[];
  networks: string[];
  has_router: boolean;
  score: number;
  last_seen: string;
  notes?: string;
  seed: boolean;
}

export type BountyType = 'reindex' | 'route_canary' | 'trust_ping' | 'feature_slot';
export type BountyStatus = 'open' | 'claimed' | 'verified' | 'rejected' | 'expired' | 'paid';

export interface AttentionBounty {
  id: string;
  type: BountyType;
  status: BountyStatus;
  created_at: string;
  expires_at: string;
  sponsor_origin: string;
  target_origin?: string;
  target_url: string;
  reward_usdc: number;
  challenge: string;
  claim?: {
    crawler_id: string;
    crawler_origin?: string;
    submitted_at: string;
    proof: Record<string, unknown>;
  };
  verification?: {
    ok: boolean;
    checked_at: string;
    detail: string;
    extracted?: Record<string, unknown>;
  };
  payer?: string;
  seed?: boolean;
}

interface PersistedShape {
  version: 1;
  targets: AttentionTarget[];
  bounties: AttentionBounty[];
  updated_at: string;
}

const SML_SPONSORS = [
  'https://mcp-x402.onrender.com',
  'https://acp-x402-scriptmasterlabs.onrender.com',
  'https://scriptmaster-vending-router.onrender.com',
] as const;

function dataPath(): string {
  if (process.env['ATTENTION_DATA_FILE']) return process.env['ATTENTION_DATA_FILE'];
  if (process.env['ATTENTION_DATA_DIR']) {
    return join(process.env['ATTENTION_DATA_DIR'], 'attention-state.json');
  }
  const stats = process.env['X402_STATS_FILE'] || process.env['STATS_FILE'];
  if (stats) {
    const dir = dirname(stats);
    return dir && dir !== '.' ? join(dir, 'attention-state.json') : '/tmp/attention-state.json';
  }
  return '/tmp/attention-state.json';
}

const targets = new Map<string, AttentionTarget>();
const bounties = new Map<string, AttentionBounty>();

let redis: RedisClientType | null = null;
let redisReady = false;
let backend: 'redis' | 'local_json_ephemeral' = 'local_json_ephemeral';
let dirty = false;
let lastFlush = 0;
const flushEveryMs = 1500;
let bootReady = false;

function snapshot(): PersistedShape {
  return {
    version: 1,
    targets: [...targets.values()],
    bounties: [...bounties.values()].slice(-MAX_BOUNTIES),
    updated_at: new Date().toISOString(),
  };
}

function applyPersisted(data: PersistedShape): void {
  if (!data || data.version !== 1) return;
  for (const t of data.targets || []) {
    if (t?.id) targets.set(t.id, t);
  }
  for (const b of data.bounties || []) {
    if (b?.id) bounties.set(b.id, b);
  }
}

function loadLocal(): void {
  const path = dataPath();
  try {
    if (!existsSync(path)) return;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as PersistedShape;
    applyPersisted(raw);
  } catch {
    // corrupt — keep memory
  }
}

function flushLocal(force: boolean): void {
  if (!dirty && !force) return;
  const now = Date.now();
  if (!force && now - lastFlush < flushEveryMs) return;
  const path = dataPath();
  try {
    const dir = dirname(path);
    if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(snapshot()));
    renameSync(tmp, path);
    lastFlush = now;
    dirty = false;
  } catch {
    // read-only disk — keep memory
  }
}

async function flushRedis(): Promise<void> {
  if (!redis || !redisReady) return;
  try {
    await redis.set(REDIS_KEY, JSON.stringify(snapshot()));
  } catch {
    /* best-effort */
  }
}

function persist(force = false): void {
  dirty = true;
  flushLocal(force);
  if (redisReady) void flushRedis();
}

async function initRedis(): Promise<void> {
  const url = process.env['REDIS_URL'];
  if (!url) return;
  try {
    const client = createClient({ url }) as RedisClientType;
    client.on('error', () => {
      /* stay on local fallback */
    });
    await client.connect();
    redis = client;
    backend = 'redis';
    const raw = await client.get(REDIS_KEY);
    if (raw) {
      try {
        applyPersisted(JSON.parse(raw) as PersistedShape);
      } catch {
        /* ignore bad payload */
      }
    }
    redisReady = true;
    // push merged memory (local + redis + seeds) back
    dirty = true;
    await flushRedis();
    flushLocal(true);
  } catch {
    redis = null;
    redisReady = false;
    backend = 'local_json_ephemeral';
  }
}

function seedTargets(): void {
  const seeds: Omit<AttentionTarget, 'id' | 'last_seen' | 'seed'>[] = [
    {
      origin: 'https://agent402.tools',
      kind: 'index',
      name: 'Agent402.Tools',
      endpoints: [
        'https://agent402.tools/api/index',
        'https://agent402.tools/api/index/register',
        'https://agent402.tools/api/route',
        'https://agent402.tools/.well-known/x402',
        'https://agent402.tools/api/route/execute',
      ],
      networks: ['eip155:8453', 'eip155:4663'],
      has_router: true,
      score: 95,
      notes: 'Open index + Smart Order Router; primary RH board host',
    },
    {
      origin: 'https://www.x402scan.com',
      kind: 'board',
      name: 'x402scan',
      endpoints: ['https://www.x402scan.com', 'https://www.x402scan.com/resources/register'],
      networks: ['eip155:8453'],
      has_router: false,
      score: 80,
      notes: 'Settlement-weighted discovery; featured lists',
    },
    {
      origin: 'https://onchainpulse.theaslangroupllc.com',
      kind: 'manifest',
      name: 'OnchainPulse',
      endpoints: ['https://onchainpulse.theaslangroupllc.com/.well-known/x402'],
      networks: ['eip155:8453'],
      has_router: false,
      score: 60,
      notes: 'High-quality multi-network resource manifests',
    },
    {
      origin: 'https://payanagent.com',
      kind: 'index',
      name: 'PayanAgent Marketplace',
      endpoints: ['https://payanagent.com/.well-known/x402', 'https://payanagent.com/openapi.json'],
      networks: ['eip155:8453'],
      has_router: false,
      score: 55,
    },
    {
      origin: 'https://conc-exe.xyz',
      kind: 'manifest',
      name: 'Concierge Executive',
      endpoints: ['https://conc-exe.xyz/.well-known/x402'],
      networks: ['eip155:8453', 'eip155:4663'],
      has_router: false,
      score: 50,
    },
    {
      origin: 'https://scry.moreright.xyz',
      kind: 'manifest',
      name: 'scry meter',
      endpoints: ['https://scry.moreright.xyz/.well-known/x402'],
      networks: ['eip155:4663', 'eip155:8453'],
      has_router: false,
      score: 48,
    },
    {
      origin: 'https://mcp-x402.onrender.com',
      kind: 'manifest',
      name: 'ScriptMasterLabs mcp-x402',
      endpoints: [
        'https://mcp-x402.onrender.com/.well-known/x402',
        'https://mcp-x402.onrender.com/api/x402-index',
        'https://mcp-x402.onrender.com/x402/attention',
      ],
      networks: ['eip155:8453', 'eip155:4663'],
      has_router: false,
      score: 70,
      notes: 'Self — dual-rail USDC+USDG, novel pack, attention broker host',
    },
    {
      origin: 'https://acp-x402-scriptmasterlabs.onrender.com',
      kind: 'manifest',
      name: 'ScriptMasterLabs ACP x402',
      endpoints: ['https://acp-x402-scriptmasterlabs.onrender.com/.well-known/x402'],
      networks: ['eip155:8453', 'eip155:4663', 'base'],
      has_router: false,
      score: 68,
    },
    {
      origin: 'https://scriptmaster-vending-router.onrender.com',
      kind: 'manifest',
      name: 'ScriptMasterLabs Vending Router',
      endpoints: ['https://scriptmaster-vending-router.onrender.com/.well-known/x402'],
      networks: ['eip155:8453', 'eip155:4663'],
      has_router: true,
      score: 65,
      notes: 'SML vending / XRPL dual-path router',
    },
  ];

  const now = new Date().toISOString();
  for (const s of seeds) {
    const id = createHash('sha256').update(s.origin).digest('hex').slice(0, 16);
    const existing = targets.get(id);
    if (!existing) {
      targets.set(id, { ...s, id, last_seen: now, seed: true });
    } else {
      // merge endpoints / score floor from seed
      const eps = new Set([...(existing.endpoints || []), ...s.endpoints]);
      existing.endpoints = [...eps];
      existing.score = Math.max(existing.score, s.score);
      if (!existing.name) existing.name = s.name;
      if (!existing.notes && s.notes) existing.notes = s.notes;
      existing.has_router = existing.has_router || s.has_router;
      targets.set(id, existing);
    }
  }
}

/**
 * Ensure each SML origin has at least one OPEN reindex bounty.
 * Idempotent: does not duplicate if an open seed bounty already exists for sponsor.
 */
export function ensureSmlJobBoard(opts?: {
  reward_usdc?: number;
  ttl_hours?: number;
}): { created: string[]; kept: string[] } {
  const reward = Math.min(1, Math.max(0.001, Number(opts?.reward_usdc ?? 0.02)));
  const ttl = Math.min(168 * 2, Math.max(24, Number(opts?.ttl_hours ?? 72)));
  const created: string[] = [];
  const kept: string[] = [];
  const now = Date.now();

  for (const sponsor of SML_SPONSORS) {
    const open = [...bounties.values()].find(
      (b) =>
        b.sponsor_origin === sponsor &&
        b.type === 'reindex' &&
        b.status === 'open' &&
        Date.parse(b.expires_at) > now,
    );
    if (open) {
      kept.push(open.id);
      continue;
    }
    const b = createBounty({
      type: 'reindex',
      sponsor_origin: sponsor,
      reward_usdc: reward,
      ttl_hours: ttl,
      payer: 'did:sml:job-board-seed',
      seed: true,
    });
    created.push(b.id);
  }
  return { created, kept };
}

// Boot sequence
loadLocal();
seedTargets();
// createBounty not yet defined at this point for ensure — call after functions
void initRedis().then(() => {
  seedTargets();
  ensureSmlJobBoard();
  persist(true);
  bootReady = true;
});
// sync path before redis returns
setTimeout(() => {
  try {
    ensureSmlJobBoard();
    persist(true);
    bootReady = true;
  } catch {
    /* createBounty available after hoist of function decls below — order matters */
  }
}, 0);

setInterval(() => {
  flushLocal(false);
  if (redisReady) void flushRedis();
}, 4000).unref?.();
const forceFlush = () => {
  persist(true);
};
process.once('beforeExit', forceFlush);
process.once('SIGTERM', forceFlush);
process.once('SIGINT', forceFlush);

export function attentionHealth() {
  expireStale();
  const open = [...bounties.values()].filter((b) => b.status === 'open').length;
  const verified = [...bounties.values()].filter((b) => b.status === 'verified' || b.status === 'paid').length;
  return {
    ok: true,
    product: 'attention-broker',
    package: 'NEGATIVE_SPACE_14',
    thesis: 'Crawl the crawlers. Buy verified attention with x402.',
    backend,
    redis_ready: redisReady,
    boot_ready: bootReady,
    durable: backend === 'redis',
    data_path: backend === 'redis' ? REDIS_KEY : dataPath(),
    targets: targets.size,
    bounties: bounties.size,
    open_bounties: open,
    verified_bounties: verified,
    sml_sponsors: [...SML_SPONSORS],
    actions: {
      root: 'GET /x402/attention',
      discover: 'GET /x402/attention/discover',
      bounty: 'POST /x402/attention/bounty',
      claim: 'POST /x402/attention/claim',
      verify: 'POST /x402/attention/verify',
      status: 'GET /x402/attention/bounty/:id',
    },
  };
}

function expireStale(): void {
  const now = Date.now();
  let changed = false;
  for (const b of bounties.values()) {
    if (b.status === 'open' && Date.parse(b.expires_at) < now) {
      b.status = 'expired';
      changed = true;
    }
  }
  if (changed) persist();
}

export function listTargets(opts?: { kind?: string; min_score?: number; q?: string }) {
  expireStale();
  let rows = [...targets.values()];
  if (opts?.kind) rows = rows.filter((t) => t.kind === opts.kind);
  if (opts?.min_score != null) rows = rows.filter((t) => t.score >= (opts.min_score as number));
  if (opts?.q) {
    const q = opts.q.toLowerCase();
    rows = rows.filter(
      (t) =>
        t.origin.toLowerCase().includes(q) ||
        (t.name || '').toLowerCase().includes(q) ||
        (t.notes || '').toLowerCase().includes(q),
    );
  }
  rows.sort((a, b) => b.score - a.score);
  return {
    count: rows.length,
    targets: rows,
    backend,
    durable: backend === 'redis',
    how_to_buy_attention: {
      step1: 'POST /x402/attention/bounty { type, sponsor_origin, target_url? }',
      step2: 'Crawler POST /x402/attention/claim with proof',
      step3: 'POST /x402/attention/verify — we re-check proof; mark verified',
      reward:
        'Listed on bounty; settlement via x402 snack fee (broker cut) + optional crawler payout off-band/on-chain',
    },
  };
}

export async function probeAndUpsert(origin: string): Promise<AttentionTarget> {
  const base = origin.replace(/\/$/, '');
  const id = createHash('sha256').update(base).digest('hex').slice(0, 16);
  const endpoints: string[] = [];
  const networks = new Set<string>();
  let has_router = false;
  let name: string | undefined;
  let kind: AttentionTargetKind = 'unknown';
  let score = 20;

  const tryPaths = [
    '/.well-known/x402',
    '/openapi.json',
    '/llms.txt',
    '/api/index',
    '/api/route',
    '/api/route/execute',
    '/x402/attention',
    '/health',
  ];

  for (const path of tryPaths) {
    const url = base + path;
    try {
      const r = await fetch(url, {
        method: path.includes('execute') ? 'OPTIONS' : 'GET',
        headers: { Accept: 'application/json,*/*', 'User-Agent': 'SML-AttentionBroker/1.1' },
        signal: AbortSignal.timeout(8_000),
        redirect: 'follow',
      } as RequestInit);
      if (r.status === 404 || r.status === 405) {
        if (r.status === 405 && path.includes('execute')) {
          has_router = true;
          endpoints.push(url);
          score += 15;
        }
        continue;
      }
      if (r.status >= 200 && r.status < 500) {
        endpoints.push(url);
        if (path === '/.well-known/x402' && r.status === 200) {
          kind = 'manifest';
          score += 25;
          try {
            const j = (await r.json()) as Record<string, unknown>;
            const info = j.info as { title?: string } | undefined;
            name = String(j.name || info?.title || base);
            const nets = j.networks;
            if (Array.isArray(nets)) nets.forEach((n) => networks.add(String(n)));
            if (typeof j.network === 'string') networks.add(j.network);
            const res = j.resources;
            if (Array.isArray(res) && res.length) score += Math.min(20, Math.floor(res.length / 10));
            if (j.payToByNetwork) score += 10;
          } catch {
            /* */
          }
        }
        if (path === '/api/index' && r.status === 200) {
          kind = 'index';
          score += 30;
        }
        if (path === '/api/route' && r.status === 200) {
          has_router = true;
          kind = kind === 'unknown' ? 'router' : kind;
          score += 20;
        }
        if (path === '/x402/attention' && r.status === 200) {
          score += 12;
          kind = kind === 'unknown' ? 'index' : kind;
        }
      }
    } catch {
      /* timeout/dns */
    }
  }

  const existing = targets.get(id);
  const row: AttentionTarget = {
    id,
    origin: base,
    kind: kind === 'unknown' && existing ? existing.kind : kind,
    name: name || existing?.name || base.replace(/^https?:\/\//, ''),
    endpoints: endpoints.length ? endpoints : existing?.endpoints || [base],
    networks: networks.size ? [...networks] : existing?.networks || [],
    has_router: has_router || Boolean(existing?.has_router),
    score: Math.min(99, Math.max(score, existing?.score || 0)),
    last_seen: new Date().toISOString(),
    notes: existing?.notes,
    seed: existing?.seed || false,
  };
  targets.set(id, row);
  persist();
  return row;
}

export function createBounty(input: {
  type?: BountyType;
  sponsor_origin: string;
  target_origin?: string;
  target_url?: string;
  reward_usdc?: number;
  ttl_hours?: number;
  payer?: string;
  seed?: boolean;
}): AttentionBounty {
  const type: BountyType = input.type || 'reindex';
  const sponsor = String(input.sponsor_origin || '').replace(/\/$/, '');
  if (!sponsor.startsWith('http')) throw new Error('sponsor_origin must be https URL');

  const reward = Math.min(1, Math.max(0.001, Number(input.reward_usdc ?? 0.01)));
  const ttl = Math.min(168 * 2, Math.max(1, Number(input.ttl_hours ?? 24)));
  const now = Date.now();
  const challenge =
    randomUUID().replace(/-/g, '') + createHash('sha256').update(sponsor + now).digest('hex').slice(0, 16);

  const b: AttentionBounty = {
    id: randomUUID(),
    type,
    status: 'open',
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttl * 3600_000).toISOString(),
    sponsor_origin: sponsor,
    target_origin: input.target_origin,
    target_url: input.target_url || `${sponsor}/.well-known/x402`,
    reward_usdc: reward,
    challenge,
    payer: input.payer,
    seed: Boolean(input.seed),
  };

  bounties.set(b.id, b);
  persist(true);
  return b;
}

export function getBounty(id: string) {
  expireStale();
  const b = bounties.get(id);
  if (!b) return null;
  return b;
}

export function listBounties(status?: string) {
  expireStale();
  let rows = [...bounties.values()];
  if (status) rows = rows.filter((b) => b.status === status);
  rows.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return { count: rows.length, bounties: rows.slice(0, 100), backend, durable: backend === 'redis' };
}

export function claimBounty(input: {
  bounty_id: string;
  crawler_id: string;
  crawler_origin?: string;
  proof: Record<string, unknown>;
}): { ok: true; bounty: AttentionBounty } | { ok: false; error: string } {
  expireStale();
  const b = bounties.get(input.bounty_id);
  if (!b) return { ok: false, error: 'bounty_not_found' };
  if (b.status === 'expired' || Date.parse(b.expires_at) < Date.now()) {
    b.status = 'expired';
    persist();
    return { ok: false, error: 'bounty_expired' };
  }
  if (b.status !== 'open' && b.status !== 'claimed') {
    return { ok: false, error: `bounty_${b.status}` };
  }
  const echoed = String(input.proof['challenge'] ?? '');
  if (echoed !== b.challenge) {
    return { ok: false, error: 'challenge_mismatch' };
  }
  b.status = 'claimed';
  b.claim = {
    crawler_id: String(input.crawler_id).slice(0, 128),
    crawler_origin: input.crawler_origin ? String(input.crawler_origin).slice(0, 256) : undefined,
    submitted_at: new Date().toISOString(),
    proof: input.proof,
  };
  persist(true);
  return { ok: true, bounty: b };
}

export async function verifyBounty(bounty_id: string): Promise<AttentionBounty | { error: string }> {
  expireStale();
  const b = bounties.get(bounty_id);
  if (!b) return { error: 'bounty_not_found' };
  if (!b.claim) return { error: 'not_claimed' };

  const checked_at = new Date().toISOString();
  try {
    const r = await fetch(b.target_url, {
      headers: { Accept: 'application/json', 'User-Agent': 'SML-AttentionBroker-Verify/1.1' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) {
      b.status = 'rejected';
      b.verification = { ok: false, checked_at, detail: `target_http_${r.status}` };
      persist(true);
      // keep job board stocked
      ensureSmlJobBoard();
      return b;
    }
    const j = (await r.json()) as Record<string, unknown>;
    const networks = Array.isArray(j.networks) ? j.networks.map(String) : [];
    if (typeof j.network === 'string' && !networks.includes(j.network)) networks.push(j.network);
    // also scan resources for networks
    const resources = j.resources;
    if (Array.isArray(resources)) {
      for (const item of resources) {
        if (item && typeof item === 'object') {
          const rn = (item as { networks?: unknown }).networks;
          if (Array.isArray(rn)) rn.forEach((n) => networks.push(String(n)));
        }
      }
    }
    const uniqNets = [...new Set(networks)];
    const toolCount = Number(
      j.toolCount || j.paidToolCount || (Array.isArray(resources) ? resources.length : 0),
    );
    const hasNetworks = uniqNets.some(
      (n) => n.includes('8453') || n.includes('4663') || n === 'base' || n.includes('eip155'),
    );
    const hasResources = (Array.isArray(resources) && resources.length > 0) || toolCount > 0;
    const proofNets = b.claim.proof['networks'] || b.claim.proof['fetched_networks'];
    let proofAlign = true;
    if (Array.isArray(proofNets) && proofNets.length) {
      proofAlign = proofNets
        .map(String)
        .some((n) => uniqNets.includes(n) || uniqNets.some((x) => x.includes(n) || n.includes(x)));
    }

    const ok = hasNetworks && hasResources && proofAlign;
    b.status = ok ? 'verified' : 'rejected';
    b.verification = {
      ok,
      checked_at,
      detail: ok
        ? 'verified_manifest_networks_and_resources'
        : `fail networks=${hasNetworks} resources=${hasResources} proofAlign=${proofAlign}`,
      extracted: {
        networks: uniqNets,
        toolCount,
        payTo: j.payTo || j.payToByNetwork,
        name: j.name || (j.info as { title?: string } | undefined)?.title,
      },
    };
    try {
      await probeAndUpsert(b.sponsor_origin);
    } catch {
      /* */
    }
    persist(true);
    // always restock open SML board after claim lifecycle
    ensureSmlJobBoard();
    return b;
  } catch (err) {
    b.status = 'rejected';
    b.verification = {
      ok: false,
      checked_at,
      detail: `fetch_error:${String(err).slice(0, 120)}`,
    };
    persist(true);
    ensureSmlJobBoard();
    return b;
  }
}

// Deferred boot ensure once createBounty is defined (function declarations are hoisted for ensureSmlJobBoard body)
try {
  ensureSmlJobBoard();
  persist(true);
  bootReady = true;
} catch {
  /* */
}
