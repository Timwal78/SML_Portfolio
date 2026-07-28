import { createHash, randomBytes } from 'crypto';
import { EchonetStore, addUnits, type Bounty, type BountyClaim } from './store.js';
import { isSelfWallet, normalizeAddr, taskTypeFromResource } from './identity.js';
import type { GraphEdge } from './store.js';

const DEFAULT_CUT_BPS = Math.max(0, Math.min(5000, parseInt(process.env['ECHONET_PROTOCOL_CUT_BPS'] || '1500', 10) || 1500));
const LISTING_FEE_UNITS = (process.env['ECHONET_LISTING_FEE_UNITS'] || '10000'); // $0.01

export function listingFeeUnits(): string {
  return LISTING_FEE_UNITS;
}

export function protocolCutBps(): number {
  return DEFAULT_CUT_BPS;
}

function id(): string {
  return randomBytes(8).toString('hex');
}

function attestation(claim: Omit<BountyClaim, 'attestation'>): string {
  return createHash('sha256')
    .update(JSON.stringify({ ...claim, v: 1, rail: 'echonet-sml' }))
    .digest('hex');
}

export function listBounties(opts?: { status?: string; resource?: string }): Bounty[] {
  const s = EchonetStore.getInstance().getState();
  let out = s.bounties.slice();
  if (opts?.status) out = out.filter((b) => b.status === opts.status);
  if (opts?.resource) {
    const r = opts.resource.toLowerCase();
    out = out.filter((b) => b.resource.toLowerCase().includes(r));
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getBounty(bid: string): Bounty | null {
  return EchonetStore.getInstance().getState().bounties.find((b) => b.id === bid) || null;
}

export function createBounty(input: {
  resource: string;
  rewardUnits: string;
  maxClaims: number;
  minSettleUnits?: string;
  poster: string;
  title: string;
  description?: string;
  resourceMatch?: 'exact' | 'prefix' | 'any';
  expiresAt?: string | null;
  listingFeeUnits?: string;
  taskTypes?: string[];
}): Bounty {
  const reward = BigInt(input.rewardUnits || '0');
  if (reward < 1000n) throw new Error('reward_too_small_min_1000');
  const maxClaims = Math.max(1, Math.min(input.maxClaims || 1, 100));
  const bounty: Bounty = {
    id: id(),
    resource: input.resource,
    resourceMatch: input.resourceMatch || 'prefix',
    rewardUnits: reward.toString(),
    maxClaims,
    minSettleUnits: input.minSettleUnits || '1000',
    poster: normalizeAddr(input.poster) || input.poster,
    posterFeeUnits: input.listingFeeUnits || '0',
    protocolCutBps: DEFAULT_CUT_BPS,
    status: 'open',
    claims: 0,
    claimedBy: [],
    title: (input.title || 'Reverse bounty').slice(0, 120),
    description: (input.description || '').slice(0, 2000),
    createdAt: new Date().toISOString(),
    expiresAt: input.expiresAt ?? null,
    taskTypes: input.taskTypes || [taskTypeFromResource(input.resource)],
  };
  EchonetStore.getInstance().mutate((s) => {
    s.bounties.unshift(bounty);
    if (bounty.posterFeeUnits !== '0') {
      s.stats.listingFeeUnits = addUnits(s.stats.listingFeeUnits, bounty.posterFeeUnits);
    }
  });
  return bounty;
}

function resourceMatches(b: Bounty, resource: string): boolean {
  const r = resource.toLowerCase();
  const target = b.resource.toLowerCase();
  if (b.resourceMatch === 'any') return true;
  if (b.resourceMatch === 'exact') return r === target || r.endsWith(target);
  // prefix: bounty resource path contained in settle resource
  try {
    const path = new URL(resource).pathname.toLowerCase();
    if (target.startsWith('http')) {
      const tp = new URL(b.resource).pathname.toLowerCase();
      return path === tp || path.startsWith(tp);
    }
    return path.includes(target) || r.includes(target);
  } catch {
    return r.includes(target);
  }
}

export function tryClaimBounties(edge: GraphEdge): BountyClaim[] {
  if (edge.self || isSelfWallet(edge.from)) return [];
  const store = EchonetStore.getInstance();
  const created: BountyClaim[] = [];
  const now = Date.now();

  store.mutate((s) => {
    for (const b of s.bounties) {
      if (b.status !== 'open') continue;
      if (b.expiresAt && Date.parse(b.expiresAt) < now) {
        b.status = 'exhausted';
        continue;
      }
      if (b.claims >= b.maxClaims) {
        b.status = 'exhausted';
        continue;
      }
      if (!resourceMatches(b, edge.resource)) continue;
      if (BigInt(edge.units || '0') < BigInt(b.minSettleUnits || '0')) continue;
      const payer = normalizeAddr(edge.from);
      if (b.claimedBy.includes(payer)) continue;

      const reward = BigInt(b.rewardUnits);
      const cut = (reward * BigInt(b.protocolCutBps)) / 10000n;
      const net = reward - cut;
      const base = {
        id: id(),
        bountyId: b.id,
        payer,
        settleTx: edge.tx,
        resource: edge.resource,
        rewardUnits: reward.toString(),
        protocolCutUnits: cut.toString(),
        netRewardUnits: net.toString(),
        status: 'earned' as const,
        payoutTx: null,
        createdAt: new Date().toISOString(),
      };
      const claim: BountyClaim = { ...base, attestation: attestation(base) };
      b.claims += 1;
      b.claimedBy.push(payer);
      if (b.claims >= b.maxClaims) b.status = 'exhausted';
      s.claims.unshift(claim);
      s.stats.bountyPaidUnits = addUnits(s.stats.bountyPaidUnits, net.toString());
      created.push(claim);
    }
  });

  return created;
}

export function seedSmlBootstrapBounties(baseHost: string): Bounty[] {
  const existing = listBounties({ status: 'open' });
  if (existing.some((b) => b.poster === 'did:sml:operator' || b.title.includes('SML bootstrap'))) {
    return existing.filter((b) => b.status === 'open');
  }
  const host = baseHost.replace(/\/$/, '');
  const mk = (path: string, title: string) =>
    createBounty({
      resource: `${host}${path}`,
      rewardUnits: process.env['ECHONET_BOOTSTRAP_REWARD_UNITS'] || '50000', // $0.05
      maxClaims: parseInt(process.env['ECHONET_BOOTSTRAP_MAX_CLAIMS'] || '5', 10) || 5,
      minSettleUnits: '1000',
      poster: 'did:sml:operator',
      title: `SML bootstrap: ${title}`,
      description:
        'First unique stranger wallets that settle a real x402 payment on this endpoint earn a reverse bounty. Self/seed wallets excluded. Protocol cut applies. Visibility = real use.',
      resourceMatch: 'prefix',
      listingFeeUnits: '0',
      taskTypes: [path.replace('/x402/', '')],
    });

  return [
    mk('/x402/llm-chat', 'llm-chat'),
    mk('/x402/web-search', 'web-search'),
    mk('/x402/web-fetch', 'web-fetch'),
    mk('/x402/social-search', 'social-search'),
    mk('/x402/base-rpc', 'base-rpc'),
  ];
}

export function claimsForPayer(payer: string): BountyClaim[] {
  const a = normalizeAddr(payer);
  return EchonetStore.getInstance().getState().claims.filter((c) => c.payer === a);
}

export function publicBoard(): {
  thesis: string;
  protocolCutBps: number;
  listingFeeUsdc: number;
  open: Array<Record<string, unknown>>;
  recentClaims: Array<Record<string, unknown>>;
  stats: {
    strangerSettles: number;
    selfSettles: number;
    bountyPaidUnits: string;
    listingFeeUnits: string;
    graphQueries: number;
    hunterReports: number;
  };
} {
  const s = EchonetStore.getInstance().getState();
  return {
    thesis:
      'EchoNet: no listing rank. Visibility is emergent stranger settle volume on the SML rail. Reverse bounties pay first real users. Graph/hunter queries are metered. Forks without this ledger have zero reputation.',
    protocolCutBps: DEFAULT_CUT_BPS,
    listingFeeUsdc: Number(LISTING_FEE_UNITS) / 1e6,
    open: listBounties({ status: 'open' }).map((b) => ({
      id: b.id,
      title: b.title,
      resource: b.resource,
      rewardUsdc: Number(b.rewardUnits) / 1e6,
      remaining: Math.max(0, b.maxClaims - b.claims),
      maxClaims: b.maxClaims,
      minSettleUsdc: Number(b.minSettleUnits) / 1e6,
      taskTypes: b.taskTypes,
      expiresAt: b.expiresAt,
    })),
    recentClaims: s.claims.slice(0, 20).map((c) => ({
      id: c.id,
      bountyId: c.bountyId,
      payer: c.payer.slice(0, 10) + '…',
      netRewardUsdc: Number(c.netRewardUnits) / 1e6,
      status: c.status,
      resource: c.resource,
      attestation: c.attestation.slice(0, 16) + '…',
      ts: c.createdAt,
    })),
    stats: s.stats,
  };
}
