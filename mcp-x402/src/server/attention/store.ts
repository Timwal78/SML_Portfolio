/**
 * Attention Broker — crawler-of-crawlers + pay-for-verified-attention.
 * NEGATIVE_SPACE / AFX growth loop: find who routes spend, buy a verified poke.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = process.env['ATTENTION_DATA_DIR'] || join(process.cwd(), '.data', 'attention');
try { mkdirSync(DATA_DIR, { recursive: true }); } catch { /* */ }

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
  target_url: string; // what must be fetched (usually sponsor well-known)
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
}

const targets = new Map<string, AttentionTarget>();
const bounties = new Map<string, AttentionBounty>();

function loadJson<T>(file: string, fallback: T): T {
  const p = join(DATA_DIR, file);
  if (!existsSync(p)) return fallback;
  try { return JSON.parse(readFileSync(p, 'utf8')) as T; } catch { return fallback; }
}
function saveJson(file: string, data: unknown) {
  try { writeFileSync(join(DATA_DIR, file), JSON.stringify(data)); } catch { /* */ }
}

function persist() {
  saveJson('targets.json', [...targets.values()]);
  saveJson('bounties.json', [...bounties.values()].slice(-500));
}

function seedTargets() {
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
  ];

  const now = new Date().toISOString();
  for (const s of seeds) {
    const id = createHash('sha256').update(s.origin).digest('hex').slice(0, 16);
    if (!targets.has(id)) {
      targets.set(id, { ...s, id, last_seen: now, seed: true });
    }
  }
}

// boot
{
  for (const t of loadJson<AttentionTarget[]>('targets.json', [])) targets.set(t.id, t);
  for (const b of loadJson<AttentionBounty[]>('bounties.json', [])) bounties.set(b.id, b);
  seedTargets();
  persist();
}

export function attentionHealth() {
  const open = [...bounties.values()].filter((b) => b.status === 'open').length;
  const verified = [...bounties.values()].filter((b) => b.status === 'verified' || b.status === 'paid').length;
  return {
    ok: true,
    product: 'attention-broker',
    package: 'NEGATIVE_SPACE_14',
    thesis: 'Crawl the crawlers. Buy verified attention with x402.',
    targets: targets.size,
    bounties: bounties.size,
    open_bounties: open,
    verified_bounties: verified,
    actions: {
      discover: 'GET /x402/attention/discover',
      bounty: 'POST /x402/attention/bounty',
      claim: 'POST /x402/attention/claim',
      verify: 'POST /x402/attention/verify',
      status: 'GET /x402/attention/bounty/:id',
    },
  };
}

export function listTargets(opts?: { kind?: string; min_score?: number; q?: string }) {
  let rows = [...targets.values()];
  if (opts?.kind) rows = rows.filter((t) => t.kind === opts.kind);
  if (opts?.min_score != null) rows = rows.filter((t) => t.score >= (opts.min_score as number));
  if (opts?.q) {
    const q = opts.q.toLowerCase();
    rows = rows.filter((t) =>
      t.origin.toLowerCase().includes(q) ||
      (t.name || '').toLowerCase().includes(q) ||
      (t.notes || '').toLowerCase().includes(q),
    );
  }
  rows.sort((a, b) => b.score - a.score);
  return {
    count: rows.length,
    targets: rows,
    how_to_buy_attention: {
      step1: 'POST /x402/attention/bounty { type, sponsor_origin, target_url? }',
      step2: 'Crawler POST /x402/attention/claim with proof',
      step3: 'POST /x402/attention/verify — we re-check proof; mark verified',
      reward: 'Listed on bounty; settlement via x402 snack fee (broker cut) + optional crawler payout off-band/on-chain',
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
    '/health',
  ];

  for (const path of tryPaths) {
    const url = base + path;
    try {
      const r = await fetch(url, {
        method: path.includes('execute') ? 'OPTIONS' : 'GET',
        headers: { Accept: 'application/json,*/*', 'User-Agent': 'SML-AttentionBroker/1.0' },
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
            const j = await r.json() as Record<string, unknown>;
            name = String(j.name || j.info && (j.info as { title?: string }).title || base);
            const nets = j.networks;
            if (Array.isArray(nets)) nets.forEach((n) => networks.add(String(n)));
            if (typeof j.network === 'string') networks.add(j.network);
            const res = j.resources;
            if (Array.isArray(res) && res.length) score += Math.min(20, Math.floor(res.length / 10));
            if (j.payToByNetwork) score += 10;
          } catch { /* */ }
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
      }
    } catch { /* timeout/dns */ }
  }

  const existing = targets.get(id);
  const row: AttentionTarget = {
    id,
    origin: base,
    kind: kind === 'unknown' && existing ? existing.kind : kind,
    name: name || existing?.name || base.replace(/^https?:\/\//, ''),
    endpoints: endpoints.length ? endpoints : (existing?.endpoints || [base]),
    networks: networks.size ? [...networks] : (existing?.networks || []),
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
}): AttentionBounty {
  const type: BountyType = input.type || 'reindex';
  const sponsor = String(input.sponsor_origin || '').replace(/\/$/, '');
  if (!sponsor.startsWith('http')) throw new Error('sponsor_origin must be https URL');
  const target_url = (input.target_url || `${sponsor}/.well-known/x402`).replace(/\/$/, '').replace(/\/\.well-known\/x402$/, '') + '/.well-known/x402';
  // normalize if already well-known
  const finalUrl = (input.target_url && input.target_url.includes('.well-known'))
    ? input.target_url
    : `${sponsor}/.well-known/x402`;

  const reward = Math.min(1, Math.max(0.001, Number(input.reward_usdc ?? 0.01)));
  const ttl = Math.min(168, Math.max(1, Number(input.ttl_hours ?? 24)));
  const now = Date.now();
  const challenge = randomUUID().replace(/-/g, '') + createHash('sha256').update(sponsor + now).digest('hex').slice(0, 16);

  const b: AttentionBounty = {
    id: randomUUID(),
    type,
    status: 'open',
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttl * 3600_000).toISOString(),
    sponsor_origin: sponsor,
    target_origin: input.target_origin,
    target_url: input.target_url || finalUrl,
    reward_usdc: reward,
    challenge,
    payer: input.payer,
  };
  // Prefer explicit target_url
  if (input.target_url) b.target_url = input.target_url;
  else b.target_url = `${sponsor}/.well-known/x402`;

  bounties.set(b.id, b);
  persist();
  return b;
}

export function getBounty(id: string) {
  const b = bounties.get(id);
  if (!b) return null;
  if (b.status === 'open' && Date.parse(b.expires_at) < Date.now()) {
    b.status = 'expired';
    persist();
  }
  return b;
}

export function listBounties(status?: string) {
  let rows = [...bounties.values()];
  for (const b of rows) {
    if (b.status === 'open' && Date.parse(b.expires_at) < Date.now()) b.status = 'expired';
  }
  if (status) rows = rows.filter((b) => b.status === status);
  rows.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return { count: rows.length, bounties: rows.slice(0, 100) };
}

export function claimBounty(input: {
  bounty_id: string;
  crawler_id: string;
  crawler_origin?: string;
  proof: Record<string, unknown>;
}): { ok: true; bounty: AttentionBounty } | { ok: false; error: string } {
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
  // proof must echo challenge
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
  persist();
  return { ok: true, bounty: b };
}

/**
 * Verify claim: we ourselves fetch target_url and check networks/resources,
 * and optionally match proof.fetched_networks / toolCount.
 */
export async function verifyBounty(bounty_id: string): Promise<AttentionBounty | { error: string }> {
  const b = bounties.get(bounty_id);
  if (!b) return { error: 'bounty_not_found' };
  if (!b.claim) return { error: 'not_claimed' };

  const checked_at = new Date().toISOString();
  try {
    const r = await fetch(b.target_url, {
      headers: { Accept: 'application/json', 'User-Agent': 'SML-AttentionBroker-Verify/1.0' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) {
      b.status = 'rejected';
      b.verification = { ok: false, checked_at, detail: `target_http_${r.status}` };
      persist();
      return b;
    }
    const j = await r.json() as Record<string, unknown>;
    const networks = Array.isArray(j.networks) ? j.networks.map(String) : [];
    if (typeof j.network === 'string' && !networks.includes(j.network)) networks.push(j.network);
    const resources = j.resources;
    const toolCount = Number(j.toolCount || j.paidToolCount || (Array.isArray(resources) ? resources.length : 0));
    const hasNetworks = networks.some((n) => n.includes('8453') || n.includes('4663') || n === 'base');
    const hasResources = (Array.isArray(resources) && resources.length > 0) || toolCount > 0;
    const proofNets = b.claim.proof['networks'] || b.claim.proof['fetched_networks'];
    let proofAlign = true;
    if (Array.isArray(proofNets) && proofNets.length) {
      proofAlign = proofNets.map(String).some((n) => networks.includes(n) || networks.some((x) => x.includes(String(n).replace('eip155:', ''))));
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
        networks,
        toolCount,
        payTo: j.payTo || j.payToByNetwork,
        name: j.name || (j.info as { title?: string } | undefined)?.title,
      },
    };
    // refresh target score if sponsor
    try { await probeAndUpsert(b.sponsor_origin); } catch { /* */ }
    persist();
    return b;
  } catch (err) {
    b.status = 'rejected';
    b.verification = { ok: false, checked_at, detail: `fetch_error:${String(err).slice(0, 120)}` };
    persist();
    return b;
  }
}
