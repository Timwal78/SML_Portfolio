import { createHash, randomBytes } from 'crypto';
import { EchonetStore, type HunterReport } from './store.js';
import { isSelfWallet, normalizeAddr, payToIdentity } from './identity.js';

function id(): string {
  return randomBytes(8).toString('hex');
}

export function publishReport(input: {
  hunter: string;
  targetResource: string;
  ok: boolean;
  latencyMs: number;
  settleUnits?: string;
  settleTx?: string;
  feeNotes?: string;
  usefulness?: number;
  notes?: string;
  paid: boolean;
}): HunterReport {
  const hunter = normalizeAddr(input.hunter) || input.hunter;
  const report: HunterReport = {
    id: id(),
    hunter,
    targetResource: input.targetResource,
    targetPayTo: payToIdentity(),
    ok: !!input.ok,
    latencyMs: Math.max(0, Math.min(input.latencyMs || 0, 600000)),
    settleUnits: input.settleUnits || '0',
    settleTx: input.settleTx || '',
    feeNotes: (input.feeNotes || '').slice(0, 500),
    usefulness: Math.max(0, Math.min(input.usefulness ?? 50, 100)),
    notes: (input.notes || '').slice(0, 2000),
    paid: input.paid,
    createdAt: new Date().toISOString(),
    signature: '',
  };
  report.signature = createHash('sha256')
    .update(JSON.stringify({ ...report, signature: undefined, v: 1 }))
    .digest('hex');

  EchonetStore.getInstance().mutate((s) => {
    s.reports.unshift(report);
    s.stats.hunterReports += 1;
  });
  return report;
}

export function listReports(opts?: { resource?: string; limit?: number }): HunterReport[] {
  const limit = Math.max(1, Math.min(opts?.limit ?? 25, 100));
  let reps = EchonetStore.getInstance().getState().reports.slice();
  if (opts?.resource) {
    const r = opts.resource.toLowerCase();
    reps = reps.filter((x) => x.targetResource.toLowerCase().includes(r));
  }
  return reps.slice(0, limit);
}

export function hunterLeaderboard(limit = 20): Array<{ hunter: string; reports: number; okRate: number; avgLatencyMs: number }> {
  const map = new Map<string, { n: number; ok: number; lat: number }>();
  for (const r of EchonetStore.getInstance().getState().reports) {
    if (isSelfWallet(r.hunter)) continue;
    const cur = map.get(r.hunter) || { n: 0, ok: 0, lat: 0 };
    cur.n += 1;
    if (r.ok) cur.ok += 1;
    cur.lat += r.latencyMs;
    map.set(r.hunter, cur);
  }
  return [...map.entries()]
    .map(([hunter, v]) => ({
      hunter,
      reports: v.n,
      okRate: v.n ? v.ok / v.n : 0,
      avgLatencyMs: v.n ? Math.round(v.lat / v.n) : 0,
    }))
    .sort((a, b) => b.reports - a.reports || b.okRate - a.okRate)
    .slice(0, limit);
}
