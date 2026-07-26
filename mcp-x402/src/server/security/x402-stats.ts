import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

// Real-time counters for x402 payment activity — hooked into FacilitatorChain.
// Counts are real, never seeded. Persists to disk when possible so redeploys
// don't zero the proof counters (Render disk path via X402_STATS_FILE or
// fallback /tmp/x402-stats.json which survives soft restarts only).

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

  private constructor() {
    this.load();
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

  private load(): void {
    const path = statsPath();
    try {
      if (!existsSync(path)) return;
      const raw = readFileSync(path, 'utf8');
      const data = JSON.parse(raw) as PersistedShape;
      if (data.startedAt) this.startedAt = data.startedAt;
      if (data.requestsByRoute) {
        this.requestsByRoute = new Map(Object.entries(data.requestsByRoute));
      }
      if (data.settledByFacilitator) {
        this.settledByFacilitator = new Map(Object.entries(data.settledByFacilitator));
      }
      if (data.failedByFacilitatorStage) {
        this.failedByFacilitatorStage = new Map(Object.entries(data.failedByFacilitatorStage));
      }
      if (Array.isArray(data.recentSettled)) this.recentSettled = data.recentSettled.slice(0, this.maxRecent);
      if (Array.isArray(data.recentFailed)) this.recentFailed = data.recentFailed.slice(0, this.maxRecent);
      if (typeof data.aiAgentsAllTime === 'number') this.aiAgentsAllTime = data.aiAgentsAllTime;
    } catch {
      // corrupt or unreadable — start fresh
    }
  }

  private flush(force: boolean): void {
    if (!this.dirty && !force) return;
    const now = Date.now();
    if (!force && now - this.lastPersist < this.persistEveryMs) return;
    const path = statsPath();
    try {
      const dir = dirname(path);
      if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
      const payload: PersistedShape = {
        startedAt: this.startedAt,
        requestsByRoute: Object.fromEntries(this.requestsByRoute),
        settledByFacilitator: Object.fromEntries(this.settledByFacilitator),
        failedByFacilitatorStage: Object.fromEntries(this.failedByFacilitatorStage),
        recentSettled: this.recentSettled,
        recentFailed: this.recentFailed,
        aiAgentsAllTime: this.aiAgentsAllTime,
      };
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

  recordSettled(facilitator: string, payer: string, tx: string, resource: string): void {
    this.settledByFacilitator.set(facilitator, (this.settledByFacilitator.get(facilitator) ?? 0) + 1);
    this.aiAgentsAllTime += 1;
    this.recentSettled.unshift({
      facilitator,
      payerHash: hashWallet(payer),
      tx,
      route: routeFromResource(resource),
      ts: new Date().toISOString(),
    });
    if (this.recentSettled.length > this.maxRecent) this.recentSettled.length = this.maxRecent;
    this.touch();
  }

  recordFailed(stage: 'verify' | 'settle', facilitator: string, reason: string, resource: string): void {
    const key = `${facilitator}:${stage}`;
    this.failedByFacilitatorStage.set(key, (this.failedByFacilitatorStage.get(key) ?? 0) + 1);
    this.recentFailed.unshift({
      facilitator,
      stage,
      reason: reason.slice(0, 200),
      route: routeFromResource(resource),
      ts: new Date().toISOString(),
    });
    if (this.recentFailed.length > this.maxRecent) this.recentFailed.length = this.maxRecent;
    this.touch();
  }

  /** Optional: bump all-time agent visit counter from public request middleware. */
  recordAgentVisit(): void {
    this.aiAgentsAllTime += 1;
    this.touch();
  }

  getAiAgentsAllTime(): number {
    return this.aiAgentsAllTime;
  }

  snapshot(): Record<string, unknown> {
    return {
      startedAt: new Date(this.startedAt).toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      note:
        'Persists to X402_STATS_FILE or /tmp/x402-stats.json when disk is writable. Real counts only — never simulated.',
      statsFile: statsPath(),
      aiAgentsAllTime: this.aiAgentsAllTime,
      requestsByRoute: Object.fromEntries(this.requestsByRoute),
      settledByFacilitator: Object.fromEntries(this.settledByFacilitator),
      failedByFacilitatorStage: Object.fromEntries(this.failedByFacilitatorStage),
      recentSettled: this.recentSettled,
      recentFailed: this.recentFailed,
    };
  }
}
