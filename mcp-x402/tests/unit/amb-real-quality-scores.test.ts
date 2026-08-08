import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Regression tests for the 2026-08-06 fix: AMB's reputationScore /
 * successRate24h / uptime24h / avgLatencyMs were 100% hardcoded constants
 * (0.94 / 0.987 / 0.999 / 420ms) applied identically to EVERY tool in
 * defaultMagnetCatalog(), computed from nothing — a live public discovery
 * document (GET /.well-known/amb.json) presenting fabricated quality
 * signals as real ones. This proves the replacement is genuinely real:
 * different tools with different real call histories get different real
 * numbers, tools with no real history honestly disclose that instead of
 * inventing one, and the previously-always-zero `settlements` field now
 * reflects real per-route settled counts.
 */

function scratchStatsPath(): string {
  return join(tmpdir(), `x402-stats-amb-test-${Math.random().toString(36).slice(2)}.json`);
}
let currentScratchPath: string;

beforeEach(() => {
  vi.resetModules();
  delete process.env['REDIS_URL'];
  currentScratchPath = scratchStatsPath();
  process.env['X402_STATS_FILE'] = currentScratchPath;
});

afterEach(() => {
  if (currentScratchPath && existsSync(currentScratchPath)) unlinkSync(currentScratchPath);
  delete process.env['X402_STATS_FILE'];
});

describe('amb-quality.computeRealToolMetrics', () => {
  it('discloses insufficient_samples (not a fabricated number) for a tracked tool with zero real calls', async () => {
    const { computeRealToolMetrics } = await import('../../src/server/amb/amb-quality.js');
    const m = computeRealToolMetrics('gas_tracker');
    expect(m.dataConfidence).toBe('insufficient_samples');
    expect(m.sampleSize).toBe(0);
    expect(m.settlements).toBe(0);
    // still returns the scoring formula's own documented cold-start prior —
    // never NaN/undefined, but the confidence flag makes clear it's a
    // default, not a measurement.
    expect(m.avgLatencyMs).toBe(420);
    expect(m.note).toMatch(/too few|neutral defaults/i);
  });

  it('discloses not_tracked (never a guess) for a catalog tool with no verified resource-key mapping', async () => {
    const { computeRealToolMetrics } = await import('../../src/server/amb/amb-quality.js');
    const m = computeRealToolMetrics('squeeze_scanner');
    expect(m.dataConfidence).toBe('not_tracked');
    expect(m.note).toMatch(/no verified resource-key mapping/i);
  });

  it('computes a REAL successRate/settlements once enough real calls exist, and it is NOT the old hardcoded 0.94/0.987/0.999/420 constants', async () => {
    const { X402Stats } = await import('../../src/server/security/x402-stats.js');
    const stats = X402Stats.getInstance();
    // 8 real settled, 2 real failed against gas_tracker's real resource key.
    for (let i = 0; i < 8; i++) {
      stats.recordSettled('cdp', '0xabc', `0xtx${i}`, '/x402/gas-tracker', 100 + i * 10);
    }
    for (let i = 0; i < 2; i++) {
      stats.recordFailed('settle', 'cdp', 'insufficient_funds', '/x402/gas-tracker');
    }

    const { computeRealToolMetrics } = await import('../../src/server/amb/amb-quality.js');
    const m = computeRealToolMetrics('gas_tracker');
    expect(m.dataConfidence).toBe('measured');
    expect(m.sampleSize).toBe(10);
    expect(m.settlements).toBe(8);
    expect(m.successRate24h).toBeCloseTo(0.8, 5); // 8/(8+2)
    // Never the old hardcoded constants.
    expect(m.successRate24h).not.toBe(0.987);
    expect(m.reputationScore).not.toBe(0.94);
    expect(m.uptime24h).not.toBe(0.999);
    // reputationScore/uptime24h are honestly the same real signal, disclosed as such.
    expect(m.reputationScore).toBe(m.successRate24h);
    expect(m.uptime24h).toBe(m.successRate24h);
    // Real average of 100,110,...,170 = 135.
    expect(m.avgLatencyMs).toBe(135);
  });

  it('two different tools with different real call histories get genuinely DIFFERENT scores — proving this is no longer one shared constant', async () => {
    const { X402Stats } = await import('../../src/server/security/x402-stats.js');
    const stats = X402Stats.getInstance();
    // gas_tracker: 9 settled, 1 failed -> 90%
    for (let i = 0; i < 9; i++) stats.recordSettled('cdp', '0xabc', `0xg${i}`, '/x402/gas-tracker', 50);
    stats.recordFailed('settle', 'cdp', 'x', '/x402/gas-tracker');
    // crypto_token_price (MCP-tool routed): 3 settled, 7 failed -> 30%
    for (let i = 0; i < 3; i++) stats.recordSettled('cdp', '0xabc', `0xc${i}`, 'mcp-tool:crypto_token_price', 900);
    for (let i = 0; i < 7; i++) stats.recordFailed('settle', 'cdp', 'x', 'mcp-tool:crypto_token_price');

    const { computeRealToolMetrics } = await import('../../src/server/amb/amb-quality.js');
    const gas = computeRealToolMetrics('gas_tracker');
    const crypto = computeRealToolMetrics('crypto_token_price');
    expect(gas.dataConfidence).toBe('measured');
    expect(crypto.dataConfidence).toBe('measured');
    expect(gas.successRate24h).not.toBe(crypto.successRate24h);
    expect(gas.avgLatencyMs).not.toBe(crypto.avgLatencyMs);
    expect(gas.successRate24h).toBeCloseTo(0.9, 5);
    expect(crypto.successRate24h).toBeCloseTo(0.3, 5);
  });
});

describe('X402Stats per-route quality tracking', () => {
  it('getRouteQuality returns null successRate/avgLatencyMs (never a fabricated number) for a route with zero samples', async () => {
    const { X402Stats } = await import('../../src/server/security/x402-stats.js');
    const q = X402Stats.getInstance().getRouteQuality('/x402/nonexistent-route');
    expect(q.successRate).toBeNull();
    expect(q.avgLatencyMs).toBeNull();
    expect(q.sampleSize).toBe(0);
  });

  it('recordSettled with no durationMs argument still works (backward compatible with every pre-existing caller)', async () => {
    const { X402Stats } = await import('../../src/server/security/x402-stats.js');
    const stats = X402Stats.getInstance();
    stats.recordSettled('cdp', '0xabc', '0xtx', '/x402/fx-rate'); // no 5th arg
    const q = stats.getRouteQuality('/x402/fx-rate');
    expect(q.settled).toBe(1);
    expect(q.avgLatencyMs).toBeNull(); // no timing sample was ever provided
  });

  it('tracks settled and failed independently per route, not conflated with the facilitator-keyed counters', async () => {
    const { X402Stats } = await import('../../src/server/security/x402-stats.js');
    const stats = X402Stats.getInstance();
    stats.recordSettled('cdp', '0xabc', '0xtx1', '/x402/grants', 200);
    stats.recordFailed('verify', 'x402.org', 'bad_signature', '/x402/grants');
    stats.recordSettled('cdp', '0xabc', '0xtx2', '/x402/firms', 300); // different route
    const grants = stats.getRouteQuality('/x402/grants');
    const firms = stats.getRouteQuality('/x402/firms');
    expect(grants.settled).toBe(1);
    expect(grants.failed).toBe(1);
    expect(firms.settled).toBe(1);
    expect(firms.failed).toBe(0);
  });
});
