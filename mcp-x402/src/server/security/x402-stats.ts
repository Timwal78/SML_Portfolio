import { createHash } from 'crypto';

// Real-time, in-memory counters for actual x402 payment activity — built
// because there was no way to answer "is this actually being used" without
// reading raw Render container logs. Hooked directly into
// FacilitatorChain.process() in payments/facilitators.ts, the single choke
// point every paid route's payment attempt passes through regardless of
// which of the ~30 routes it is. Counts are real, incremented only by real
// requests — never seeded or simulated.
//
// In-memory only: resets on every redeploy/restart, same reliability as the
// existing AuditLogger's /tmp/audit.log (ephemeral container disk). This
// trades long-term history for something actually queryable over HTTP.

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

export class X402Stats {
  private static instance: X402Stats;
  private readonly startedAt = Date.now();
  private readonly maxRecent = 50;

  private requestsByRoute = new Map<string, number>();
  private settledByFacilitator = new Map<string, number>();
  private failedByFacilitatorStage = new Map<string, number>();
  private recentSettled: SettledEvent[] = [];
  private recentFailed: FailedEvent[] = [];

  static getInstance(): X402Stats {
    if (!X402Stats.instance) X402Stats.instance = new X402Stats();
    return X402Stats.instance;
  }

  recordAttempt(resource: string): void {
    const route = routeFromResource(resource);
    this.requestsByRoute.set(route, (this.requestsByRoute.get(route) ?? 0) + 1);
  }

  recordSettled(facilitator: string, payer: string, tx: string, resource: string): void {
    this.settledByFacilitator.set(facilitator, (this.settledByFacilitator.get(facilitator) ?? 0) + 1);
    this.recentSettled.unshift({
      facilitator,
      payerHash: hashWallet(payer),
      tx,
      route: routeFromResource(resource),
      ts: new Date().toISOString(),
    });
    if (this.recentSettled.length > this.maxRecent) this.recentSettled.length = this.maxRecent;
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
  }

  snapshot(): Record<string, unknown> {
    return {
      startedAt: new Date(this.startedAt).toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      note: 'In-memory only — resets on every redeploy/restart. Real counts since last restart, not historical. Never simulated.',
      requestsByRoute: Object.fromEntries(this.requestsByRoute),
      settledByFacilitator: Object.fromEntries(this.settledByFacilitator),
      failedByFacilitatorStage: Object.fromEntries(this.failedByFacilitatorStage),
      recentSettled: this.recentSettled,
      recentFailed: this.recentFailed,
    };
  }
}
