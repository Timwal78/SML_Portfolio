import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { createClient, type RedisClientType } from 'redis';

// Real-time counters for x402 payment activity — hooked into FacilitatorChain.
// Counts are real, never seeded.
//
// Durability (fixed 2026-08-01): the previous local-JSON-only persistence
// (/tmp/x402-stats.json by default) does NOT survive a Render redeploy — a
// fresh container gets a fresh /tmp, and this repo redeploys on every merge
// to main. That meant the operator could never actually answer "has a real
// payment ever settled" from this endpoint: aiAgentsAllTime silently reset
// on every deploy, same "local JSON fallback doesn't survive a redeploy"
// gap already documented for equivalent modules elsewhere in this account
// (paper_trade_ledger.py, iv_rank_tracker.py). Now uses Redis when
// REDIS_URL is configured (survives redeploy) and falls back to the same
// local-JSON behavior as before otherwise — snapshot() discloses which
// backend actually answered so this is never silently ambiguous.

const REDIS_KEY = 'x402stats:snapshot';

interface SettledEvent {
  facilitator: string;
  payerHash: string;
  tx: string;
  route: string;
  ts: string;
}

interface FailedEvent {
  facilitator: string;
  stage: 'verify' | 'settle';
  reason: string;
  route: string;
  ts: string;
}

interface PersistedShape {
  startedAt: number;
  requestsByRoute: Record<string, number>;
  settledByFacilitator: Record<string, number>;
  failedByFacilitatorStage: Record<string, number>;
  recentSettled: SettledEvent[];
  recentFailed: FailedEvent[];
  aiAgentsAllTime?: number;
  paidToday?: number;
  paidTodayDate?: string;
  settledByRoute?: Record<string, number>;
  failedByRoute?: Record<string, number>;
  latencySumMsByRoute?: Record<string, number>;
  latencyCountByRoute?: Record<string, number>;
}

export interface RouteQuality {
  route: string;
  settled: number;
  failed: number;
  /** null when settled+failed===0 — never fabricated, honestly absent. */
  successRate: number | null;
  /** null when no successful call has ever reported timing. */
  avgLatencyMs: number | null;
  sampleSize: number;
}

function hashWallet(address: string): string {
  return createHash('sha256').update(address).digest('hex').slice(0, 16) + '...';
}

function routeFromResource(resource: string): string {
  try {
    return new URL(resource).pathname;
  } catch {
    return resource;
  }
}

function statsPath(): string {
  return process.env.X402_STATS_FILE || process.env.STATS_FILE || '/tmp/x402-stats.json';
}

export class X402Stats {
  private static instance: X402Stats;
  private startedAt = Date.now();
  private readonly maxRecent = 50;
  private readonly persistEveryMs = 2000;
  private lastPersist = 0;
  private dirty = false;

  private requestsByRoute = new Map<string, number>();
  private settledByFacilitator = new Map<string, number>();
  private failedByFacilitatorStage = new Map<string, number>();
  private recentSettled: SettledEvent[] = [];
  private recentFailed: FailedEvent[] = [];
  private aiAgentsAllTime = 0;
  // Dashboard tooltip on agentswarm-seo.html has always claimed to show
  // "X paid x402 hits today", but this field never existed server-side —
  // /api/stats only ever sent aiAgentsToday (a UA-string match, not a
  // verified payment) and the dashboard's data.paidAgentsToday read was
  // silently always undefined. Real, day-resetting counter, same pattern
  // as index.ts's _agentCounts.today.
  private paidToday = 0;
  private paidTodayDate = new Date().toDateString();

  // Per-route quality signal — added 2026-08-06 after finding AMB's
  // reputationScore/successRate24h/uptime24h/avgLatencyMs were 100%
  // hardcoded constants (0.94/0.987/0.999/420ms) applied identically to
  // EVERY tool, computed from nothing. This is the real replacement data
  // source: cumulative (not a true rolling 24h window — that would need
  // timestamped time-bucketed storage this class doesn't have; "cumulative
  // since startedAt" is the honest label, see getRouteQuality()'s callers).
  private settledByRoute = new Map<string, number>();
  private failedByRoute = new Map<string, number>();
  private latencySumMsByRoute = new Map<string, number>();
  private latencyCountByRoute = new Map<string, number>();

  private redis: RedisClientType | null = null;
  private redisReady = false;
  private backend: 'redis' | 'local_json_ephemeral' = 'local_json_ephemeral';

  private constructor() {
    this.loadLocal();
    void this.initRedis();
    // flush on interval
    setInterval(() => this.flush(false), 5000).unref?.();
    const flush = () => this.flush(true);
    process.once('beforeExit', flush);
    process.once('SIGTERM', flush);
    process.once('SIGINT', flush);
  }

  static getInstance(): X402Stats {
    if (!X402Stats.instance) X402Stats.instance = new X402Stats();
    return X402Stats.instance;
  }

  private async initRedis(): Promise<void> {
    const url = process.env.REDIS_URL;
    if (!url) return;
    try {
      const client = createClient({ url }) as RedisClientType;
      client.on('error', () => { /* stay on local fallback, don't crash the process */ });
      await client.connect();
      this.redis = client;
      this.backend = 'redis';
      const raw = await client.get(REDIS_KEY);
      if (raw) this.applyPersisted(JSON.parse(raw) as PersistedShape, /* preferNewer */ true);
      this.redisReady = true;
    } catch {
      this.redis = null;
      this.backend = 'local_json_ephemeral';
    }
  }

  private applyPersisted(data: PersistedShape, preferNewer: boolean): void {
    // On Redis hydration we only adopt it if it's at least as complete as
    // what's already in memory (guards against a slow Redis connect losing
    // events recorded in the brief in-memory-only startup window).
    if (preferNewer && (data.aiAgentsAllTime ?? 0) < this.aiAgentsAllTime) return;
    if (data.startedAt) this.startedAt = data.startedAt;
    if (data.requestsByRoute) this.requestsByRoute = new Map(Object.entries(data.requestsByRoute));
    if (data.settledByFacilitator) this.settledByFacilitator = new Map(Object.entries(data.settledByFacilitator));
    if (data.failedByFacilitatorStage) this.failedByFacilitatorStage = new Map(Object.entries(data.failedByFacilitatorStage));
    if (Array.isArray(data.recentSettled)) this.recentSettled = data.recentSettled.slice(0, this.maxRecent);
    if (Array.isArray(data.recentFailed)) this.recentFailed = data.recentFailed.slice(0, this.maxRecent);
    if (typeof data.aiAgentsAllTime === 'number') this.aiAgentsAllTime = data.aiAgentsAllTime;
    // Only adopt a persisted paidToday if it's still the same calendar day —
    // otherwise a stale count from yesterday would survive a restart and
    // silently overstate today's real total.
    if (data.paidTodayDate === this.paidTodayDate && typeof data.paidToday === 'number') {
      this.paidToday = data.paidToday;
    }
    if (data.settledByRoute) this.settledByRoute = new Map(Object.entries(data.settledByRoute));
    if (data.failedByRoute) this.failedByRoute = new Map(Object.entries(data.failedByRoute));
    if (data.latencySumMsByRoute) this.latencySumMsByRoute = new Map(Object.entries(data.latencySumMsByRoute));
    if (data.latencyCountByRoute) this.latencyCountByRoute = new Map(Object.entries(data.latencyCountByRoute));
  }

  private loadLocal(): void {
    const path = statsPath();
    try {
      if (!existsSync(path)) return;
      const raw = readFileSync(path, 'utf8');
      this.applyPersisted(JSON.parse(raw) as PersistedShape, false);
    } catch {
      // corrupt or unreadable — start fresh
    }
  }

  private buildPayload(): PersistedShape {
    return {
      startedAt: this.startedAt,
      requestsByRoute: Object.fromEntries(this.requestsByRoute),
      settledByFacilitator: Object.fromEntries(this.settledByFacilitator),
      failedByFacilitatorStage: Object.fromEntries(this.failedByFacilitatorStage),
      recentSettled: this.recentSettled,
      recentFailed: this.recentFailed,
      aiAgentsAllTime: this.aiAgentsAllTime,
      paidToday: this.paidToday,
      paidTodayDate: this.paidTodayDate,
      settledByRoute: Object.fromEntries(this.settledByRoute),
      failedByRoute: Object.fromEntries(this.failedByRoute),
      latencySumMsByRoute: Object.fromEntries(this.latencySumMsByRoute),
      latencyCountByRoute: Object.fromEntries(this.latencyCountByRoute),
    };
  }

  private flush(force: boolean): void {
    if (!this.dirty && !force) return;
    const now = Date.now();
    if (!force && now - this.lastPersist < this.persistEveryMs) return;
    const payload = this.buildPayload();

    if (this.redis && this.redisReady) {
      // Fire-and-forget — never block the request path on Redis latency.
      this.redis.set(REDIS_KEY, JSON.stringify(payload)).catch(() => { /* best-effort */ });
      this.lastPersist = now;
      this.dirty = false;
      return;
    }

    const path = statsPath();
    try {
      const dir = dirname(path);
      if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(path, JSON.stringify(payload));
      this.lastPersist = now;
      this.dirty = false;
    } catch {
      // disk not writable — stay in-memory
    }
  }

  private touch(): void {
    this.dirty = true;
    this.flush(false);
  }

  recordAttempt(resource: string): void {
    const route = routeFromResource(resource);
    this.requestsByRoute.set(route, (this.requestsByRoute.get(route) ?? 0) + 1);
    this.touch();
  }

  /**
   * durationMs is optional and additive — every existing caller that predates
   * this parameter still works unchanged (route quality just has no latency
   * sample from that call). Only successful settlements report latency:
   * "how long does a real successful call take" is what AMB's avgLatencyMs
   * actually needs, and a failed/rejected call's timing isn't the same signal.
   */
  recordSettled(facilitator: string, payer: string, tx: string, resource: string, durationMs?: number): void {
    this.settledByFacilitator.set(facilitator, (this.settledByFacilitator.get(facilitator) ?? 0) + 1);
    this.aiAgentsAllTime += 1;
    const today = new Date().toDateString();
    if (today !== this.paidTodayDate) { this.paidToday = 0; this.paidTodayDate = today; }
    this.paidToday += 1;
    const route = routeFromResource(resource);
    this.settledByRoute.set(route, (this.settledByRoute.get(route) ?? 0) + 1);
    if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0) {
      this.latencySumMsByRoute.set(route, (this.latencySumMsByRoute.get(route) ?? 0) + durationMs);
      this.latencyCountByRoute.set(route, (this.latencyCountByRoute.get(route) ?? 0) + 1);
    }
    this.recentSettled.unshift({
      facilitator,
      payerHash: hashWallet(payer),
      tx,
      route,
      ts: new Date().toISOString(),
    });
    if (this.recentSettled.length > this.maxRecent) this.recentSettled.length = this.maxRecent;
    this.touch();
  }

  recordFailed(stage: 'verify' | 'settle', facilitator: string, reason: string, resource: string): void {
    const key = `${facilitator}:${stage}`;
    this.failedByFacilitatorStage.set(key, (this.failedByFacilitatorStage.get(key) ?? 0) + 1);
    const route = routeFromResource(resource);
    this.failedByRoute.set(route, (this.failedByRoute.get(route) ?? 0) + 1);
    this.recentFailed.unshift({
      facilitator,
      stage,
      reason: reason.slice(0, 200),
      route,
      ts: new Date().toISOString(),
    });
    if (this.recentFailed.length > this.maxRecent) this.recentFailed.length = this.maxRecent;
    this.touch();
  }

  /**
   * Real per-route quality — the honest replacement for AMB's old hardcoded
   * reputationScore/successRate24h/uptime24h/avgLatencyMs constants. Never
   * fabricates: successRate/avgLatencyMs are null (not a rosy guess) when
   * there isn't yet a real sample to compute them from.
   */
  getRouteQuality(route: string): RouteQuality {
    const settled = this.settledByRoute.get(route) ?? 0;
    const failed = this.failedByRoute.get(route) ?? 0;
    const latSum = this.latencySumMsByRoute.get(route) ?? 0;
    const latCount = this.latencyCountByRoute.get(route) ?? 0;
    return {
      route,
      settled,
      failed,
      successRate: settled + failed > 0 ? settled / (settled + failed) : null,
      avgLatencyMs: latCount > 0 ? Math.round(latSum / latCount) : null,
      sampleSize: settled + failed,
    };
  }

  /** Optional: bump all-time agent visit counter from public request middleware. */
  recordAgentVisit(): void {
    this.aiAgentsAllTime += 1;
    this.touch();
  }

  getAiAgentsAllTime(): number {
    return this.aiAgentsAllTime;
  }

  getPaidToday(): number {
    const today = new Date().toDateString();
    if (today !== this.paidTodayDate) return 0; // day rolled over since last recordSettled
    return this.paidToday;
  }

  snapshot(): Record<string, unknown> {
    // Distinct-payer count over the visible recentSettled window — added
    // after discovering (2026-08-03) that a self-run seeding script can
    // make settledByFacilitator/aiAgentsAllTime climb entirely from ONE
    // wallet paying itself, with no way to tell from the raw counts alone.
    // This doesn't replace checking payerHash values directly, and it is
    // NOT an all-time distinct-payer count (recentSettled is capped at
    // maxRecent=50) — it's disclosed as exactly what it is: a same-wallet
    // vs multi-wallet signal for the most recent settled calls only.
    const distinctRecentPayers = new Set(this.recentSettled.map((e) => e.payerHash)).size;
    return {
      startedAt: new Date(this.startedAt).toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      backend: this.backend,
      note:
        this.backend === 'redis'
          ? 'Persisted to Redis (REDIS_URL) — survives redeploys. Real counts only, never simulated.'
          : 'REDIS_URL not configured — persisting to X402_STATS_FILE or /tmp/x402-stats.json, which does NOT survive a Render redeploy. Set REDIS_URL for durable all-time counts. Real counts only, never simulated.',
      statsFile: this.backend === 'local_json_ephemeral' ? statsPath() : undefined,
      aiAgentsAllTime: this.aiAgentsAllTime,
      paidToday: this.getPaidToday(),
      requestsByRoute: Object.fromEntries(this.requestsByRoute),
      settledByFacilitator: Object.fromEntries(this.settledByFacilitator),
      failedByFacilitatorStage: Object.fromEntries(this.failedByFacilitatorStage),
      settledByRoute: Object.fromEntries(this.settledByRoute),
      failedByRoute: Object.fromEntries(this.failedByRoute),
      recentSettled: this.recentSettled,
      recentFailed: this.recentFailed,
      distinctRecentPayers,
      distinctRecentPayersNote:
        this.recentSettled.length === 0
          ? 'no settled payments yet'
          : distinctRecentPayers === 1
          ? `all ${this.recentSettled.length} of the most recent settled calls came from the SAME wallet — likely one payer (self-seeding or a single agent), not diverse organic traffic. This is a window signal (last ${this.maxRecent} max), not an all-time count.`
          : `${distinctRecentPayers} distinct wallets across the most recent ${this.recentSettled.length} settled calls. This is a window signal (last ${this.maxRecent} max), not an all-time count.`,
    };
  }
}
