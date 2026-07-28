/**
 * EchoNet durable JSON store — bounties, graph edges, hunter reports, claims.
 * Path: ECHONET_DATA_FILE || X402_STATS_FILE dir || /tmp/echonet-state.json
 * Protocol can be copied; THIS ledger is the only reputation root that pays.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';

export type BountyStatus = 'open' | 'paused' | 'exhausted' | 'cancelled';
export type ClaimStatus = 'earned' | 'paid' | 'failed' | 'blocked_self';

export interface Bounty {
  id: string;
  resource: string;           // exact resource URL or path suffix match
  resourceMatch: 'exact' | 'prefix' | 'any';
  rewardUnits: string;        // USDC base units (6 dec)
  maxClaims: number;
  minSettleUnits: string;
  poster: string;             // wallet or did:sml:*
  posterFeeUnits: string;     // listing fee taken by SML
  protocolCutBps: number;     // SML cut of each reward (default 1500 = 15%)
  status: BountyStatus;
  claims: number;
  claimedBy: string[];        // lowercase wallets
  title: string;
  description: string;
  createdAt: string;
  expiresAt: string | null;
  taskTypes: string[];
}

export interface BountyClaim {
  id: string;
  bountyId: string;
  payer: string;
  settleTx: string;
  resource: string;
  rewardUnits: string;
  protocolCutUnits: string;
  netRewardUnits: string;
  status: ClaimStatus;
  payoutTx: string | null;
  attestation: string;        // signed-ish hash proof
  createdAt: string;
}

export interface GraphEdge {
  id: string;
  from: string;               // payer
  to: string;                 // payTo / resource host identity
  resource: string;
  units: string;
  tx: string;
  rail: string;
  taskType: string;
  ts: string;
  self: boolean;
}

export interface HunterReport {
  id: string;
  hunter: string;
  targetResource: string;
  targetPayTo: string;
  ok: boolean;
  latencyMs: number;
  settleUnits: string;
  settleTx: string;
  feeNotes: string;
  usefulness: number;         // 0-100 self-score; market reweights later
  notes: string;
  paid: boolean;
  createdAt: string;
  signature: string;
}

export interface AgentNode {
  address: string;
  settlesOut: number;
  settlesIn: number;
  volumeOutUnits: string;
  volumeInUnits: string;
  uniqueCounterparties: number;
  lastSeen: string;
  reputation: number;
  self: boolean;
}

export interface EchonetState {
  version: 1;
  startedAt: string;
  bounties: Bounty[];
  claims: BountyClaim[];
  edges: GraphEdge[];
  reports: HunterReport[];
  agents: Record<string, AgentNode>;
  stats: {
    strangerSettles: number;
    selfSettles: number;
    bountyPaidUnits: string;
    listingFeeUnits: string;
    graphQueries: number;
    hunterReports: number;
  };
}

const MAX_EDGES = 5000;
const MAX_REPORTS = 2000;
const MAX_CLAIMS = 5000;

function defaultState(): EchonetState {
  return {
    version: 1,
    startedAt: new Date().toISOString(),
    bounties: [],
    claims: [],
    edges: [],
    reports: [],
    agents: {},
    stats: {
      strangerSettles: 0,
      selfSettles: 0,
      bountyPaidUnits: '0',
      listingFeeUnits: '0',
      graphQueries: 0,
      hunterReports: 0,
    },
  };
}

function dataPath(): string {
  if (process.env['ECHONET_DATA_FILE']) return process.env['ECHONET_DATA_FILE'];
  const stats = process.env['X402_STATS_FILE'] || process.env['STATS_FILE'];
  if (stats) {
    const dir = dirname(stats);
    return dir && dir !== '.' ? `${dir}/echonet-state.json` : '/tmp/echonet-state.json';
  }
  return '/tmp/echonet-state.json';
}

export class EchonetStore {
  private static instance: EchonetStore;
  private state: EchonetState = defaultState();
  private dirty = false;
  private lastFlush = 0;
  private readonly flushEveryMs = 1500;

  private constructor() {
    this.load();
    setInterval(() => this.flush(false), 4000).unref?.();
    const f = () => this.flush(true);
    process.once('beforeExit', f);
    process.once('SIGTERM', f);
    process.once('SIGINT', f);
  }

  static getInstance(): EchonetStore {
    if (!EchonetStore.instance) EchonetStore.instance = new EchonetStore();
    return EchonetStore.instance;
  }

  getState(): EchonetState {
    return this.state;
  }

  mutate(fn: (s: EchonetState) => void): void {
    fn(this.state);
    // cap arrays
    if (this.state.edges.length > MAX_EDGES) this.state.edges = this.state.edges.slice(-MAX_EDGES);
    if (this.state.reports.length > MAX_REPORTS) this.state.reports = this.state.reports.slice(-MAX_REPORTS);
    if (this.state.claims.length > MAX_CLAIMS) this.state.claims = this.state.claims.slice(-MAX_CLAIMS);
    this.dirty = true;
    this.flush(false);
  }

  private load(): void {
    const path = dataPath();
    try {
      if (!existsSync(path)) return;
      const raw = JSON.parse(readFileSync(path, 'utf8')) as EchonetState;
      if (raw && raw.version === 1) {
        this.state = {
          ...defaultState(),
          ...raw,
          stats: { ...defaultState().stats, ...(raw.stats || {}) },
          agents: raw.agents || {},
          bounties: raw.bounties || [],
          claims: raw.claims || [],
          edges: raw.edges || [],
          reports: raw.reports || [],
        };
      }
    } catch {
      // corrupt — fresh
    }
  }

  flush(force: boolean): void {
    if (!this.dirty && !force) return;
    const now = Date.now();
    if (!force && now - this.lastFlush < this.flushEveryMs) return;
    const path = dataPath();
    try {
      const dir = dirname(path);
      if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.state));
      renameSync(tmp, path);
      this.lastFlush = now;
      this.dirty = false;
    } catch {
      // disk may be read-only; keep memory
    }
  }
}

export function addUnits(a: string, b: string): string {
  return (BigInt(a || '0') + BigInt(b || '0')).toString();
}

export function echonetPath(): string {
  return dataPath();
}
