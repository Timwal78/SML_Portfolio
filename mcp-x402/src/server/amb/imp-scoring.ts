/**
 * IMP v0.1 multi-rail scoring — TypeScript port of imp-v0.1/imp/scoring.py
 * Used by live AMB + list_magnets ranking.
 */
import { SAFE_PAY_TO } from './amb-generator.js';

export const IMP_VERSION = '0.1.0';

export type RailHealth = Record<string, number>;

const RAIL_WEIGHTS: Array<{ id: string; weight: number; aliases?: string[] }> = [
  { id: 'base_usdc', weight: 1.0 },
  { id: 'base_usdg', weight: 0.9, aliases: ['robinhood_usdg', 'uscg'] },
  { id: 'solana_usdc', weight: 0.85 },
  { id: 'xrpl_rlusd', weight: 0.8 },
];

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, Number(x) || 0));
}

/** AMB-compatible magnet strength (legacy field kept for scanners). */
export function magnetStrength(
  reputationScore = 0.94,
  successRate24h = 0.987,
  uptime24h = 0.999,
  avgLatencyMs = 420,
): number {
  const latTerm = 1 / Math.log10(avgLatencyMs + 10);
  const raw =
    clamp01(reputationScore) * 0.5 +
    clamp01(successRate24h) * 0.25 +
    clamp01(uptime24h) * 0.15 +
    latTerm * 0.1;
  return Math.max(0, Math.min(1, Math.round(raw * 10000) / 10000));
}

export function railScore(railHealth?: RailHealth): {
  rail_score: number;
  rail_coverage: number;
  healthy_rails: number;
  total_rails: number;
  rails: Array<{ id: string; health: number; weight: number }>;
} {
  const health: Record<string, number> = {};
  for (const r of RAIL_WEIGHTS) health[r.id] = 1.0;
  if (railHealth) {
    for (const [k, v] of Object.entries(railHealth)) {
      const kid = k.toLowerCase();
      for (const r of RAIL_WEIGHTS) {
        if (r.id === kid || r.aliases?.includes(kid)) {
          health[r.id] = clamp01(v);
        }
      }
    }
  }
  let num = 0;
  let den = 0;
  let healthy = 0;
  const detail: Array<{ id: string; health: number; weight: number }> = [];
  for (const r of RAIL_WEIGHTS) {
    const h = health[r.id] ?? 0;
    num += r.weight * h;
    den += r.weight;
    if (h >= 0.5) healthy += 1;
    detail.push({ id: r.id, health: h, weight: r.weight });
  }
  const score = den ? num / den : 0;
  const coverage = RAIL_WEIGHTS.length ? healthy / RAIL_WEIGHTS.length : 0;
  return {
    rail_score: Math.round(score * 10000) / 10000,
    rail_coverage: Math.round(coverage * 10000) / 10000,
    healthy_rails: healthy,
    total_rails: RAIL_WEIGHTS.length,
    rails: detail,
  };
}

export interface ImpScoreInput {
  tool: string;
  reputation?: number;
  successRate24h?: number;
  uptime24h?: number;
  avgLatencyMs?: number;
  price?: string;
  payTo?: string;
  railHealth?: RailHealth;
  ttlMs?: number;
  issuedAtMs?: number;
  freeTier?: boolean;
  /** advertised rails on beacon — missing rails count as 0 health */
  advertisedRails?: string[];
}

export interface ImpScoreResult {
  tool: string;
  pay_to: string;
  price: string;
  free_tier: boolean;
  magnet_strength: number;
  imp_score: number;
  rail_score: number;
  rail_coverage: number;
  healthy_rails: number;
  total_rails: number;
  stale: boolean;
  orphan_refused: boolean;
  imp_version: string;
  formula: {
    magnet: string;
    imp: string;
  };
}

function normalizePayTo(payTo?: string): { payTo: string; orphanRefused: boolean } {
  const raw = (payTo || '').trim();
  if (!raw || raw.toLowerCase().startsWith('0x4e14')) {
    return { payTo: SAFE_PAY_TO, orphanRefused: Boolean(raw) };
  }
  return { payTo: raw, orphanRefused: false };
}

/**
 * Build rail health from advertised rail ids.
 * Canonical 4 rails; robinhood_usdg maps to base_usdg.
 */
export function healthFromAdvertisedRails(rails?: string[]): RailHealth {
  if (!rails?.length) {
    return {
      base_usdc: 1,
      base_usdg: 1,
      solana_usdc: 1,
      xrpl_rlusd: 1,
    };
  }
  const set = new Set(rails.map((r) => r.toLowerCase()));
  const has = (...ids: string[]) => ids.some((id) => set.has(id));
  return {
    base_usdc: has('base_usdc') ? 1 : 0,
    base_usdg: has('base_usdg', 'robinhood_usdg', 'uscg') ? 1 : 0,
    solana_usdc: has('solana_usdc') ? 1 : 0,
    xrpl_rlusd: has('xrpl_rlusd') ? 1 : 0,
  };
}

export function scoreToolImp(input: ImpScoreInput): ImpScoreResult {
  const { payTo, orphanRefused } = normalizePayTo(input.payTo ?? SAFE_PAY_TO);
  const mag = magnetStrength(
    input.reputation ?? 0.94,
    input.successRate24h ?? 0.987,
    input.uptime24h ?? 0.999,
    input.avgLatencyMs ?? 420,
  );
  const health =
    input.railHealth ??
    healthFromAdvertisedRails(input.advertisedRails);
  const rails = railScore(health);
  const issued = input.issuedAtMs ?? Date.now();
  const ttl = input.ttlMs ?? 15 * 60 * 1000;
  const age = Math.max(0, Date.now() - issued);
  const stale = age > ttl;
  const stalePenalty = stale ? 0.85 : 1.0;
  let imp = mag * 0.7 + rails.rail_score * 0.2 + rails.rail_coverage * 0.1;
  imp = Math.max(0, Math.min(1, Math.round(imp * stalePenalty * 10000) / 10000));

  return {
    tool: input.tool,
    pay_to: payTo,
    price: input.price ?? '0.001',
    free_tier: Boolean(input.freeTier),
    magnet_strength: mag,
    imp_score: imp,
    rail_score: rails.rail_score,
    rail_coverage: rails.rail_coverage,
    healthy_rails: rails.healthy_rails,
    total_rails: rails.total_rails,
    stale,
    orphan_refused: orphanRefused,
    imp_version: IMP_VERSION,
    formula: {
      magnet:
        'rep*0.50 + success*0.25 + uptime*0.15 + (1/log10(latency_ms+10))*0.10',
      imp: 'magnet*0.70 + rail_score*0.20 + rail_coverage*0.10 (*0.85 if stale)',
    },
  };
}

/** Sort key for list_magnets: prefer imp_score, fall back to magnet_strength. */
export function beaconRankScore(b: {
  imp_score?: number;
  magnet_strength?: number;
  free_tier?: boolean;
}): number {
  if (typeof b.imp_score === 'number') return b.imp_score;
  return typeof b.magnet_strength === 'number' ? b.magnet_strength : 0;
}
