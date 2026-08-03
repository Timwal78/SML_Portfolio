import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Regression tests for two real gaps found 2026-08-03 while verifying the
 * AgentSwarm SEO dashboard's numbers for the operator:
 *
 * 1. paidAgentsToday — agentswarm-seo.html's loadAgentStats() has always
 *    read data.paidAgentsToday and its tooltip has always described it as
 *    "paid x402 hits today", but /api/stats never sent that field. The
 *    dashboard's aiAgentsToday counter (a User-Agent string match) was the
 *    only number ever shown, and it does NOT verify a payment happened —
 *    a plain web crawler with a matching UA counts the same as a real
 *    paying agent. X402Stats now tracks a real, day-resetting paidToday
 *    counter incremented only from recordSettled() (an actually-verified
 *    settlement), independent of the UA-sniff counter.
 *
 * 2. distinctRecentPayers — found while investigating the operator's "is
 *    this a self payment or stranger" question: a self-run seeding script
 *    (scripts/eoa-facilitator-seed.mjs) can make settledByFacilitator and
 *    aiAgentsAllTime climb entirely from ONE wallet paying itself, and
 *    nothing in the API surfaced that — you had to manually eyeball every
 *    payerHash in recentSettled to notice they were all identical.
 *    snapshot() now computes and discloses this directly.
 */

function scratchStatsPath(): string {
  return join(tmpdir(), `x402-stats-test-${Math.random().toString(36).slice(2)}.json`);
}
let currentScratchPath: string;

beforeEach(() => {
  vi.resetModules();
  delete process.env['REDIS_URL'];
  currentScratchPath = scratchStatsPath();
  process.env['X402_STATS_FILE'] = currentScratchPath;
});

afterEach(() => {
  vi.useRealTimers();
  if (currentScratchPath && existsSync(currentScratchPath)) unlinkSync(currentScratchPath);
  delete process.env['X402_STATS_FILE'];
});

describe('X402Stats.paidToday', () => {
  it('starts at 0 with no settled payments', async () => {
    const { X402Stats } = await import('../../src/server/security/x402-stats.js');
    const stats = X402Stats.getInstance();
    expect(stats.getPaidToday()).toBe(0);
    expect(stats.snapshot()['paidToday']).toBe(0);
  });

  it('increments only on a real settled payment, not on a plain UA-matched agent visit', async () => {
    const { X402Stats } = await import('../../src/server/security/x402-stats.js');
    const stats = X402Stats.getInstance();

    // recordAgentVisit() is what the UA-sniff middleware calls for ANY
    // matching crawler/agent User-Agent — it must never move paidToday.
    stats.recordAgentVisit();
    stats.recordAgentVisit();
    expect(stats.getPaidToday()).toBe(0);
    expect(stats.getAiAgentsAllTime()).toBe(2);

    stats.recordSettled('cdp', '0xabc', '0xtx1', '/x402/fx-rate');
    expect(stats.getPaidToday()).toBe(1);

    stats.recordSettled('cdp', '0xabc', '0xtx2', '/x402/gas-tracker');
    expect(stats.getPaidToday()).toBe(2);
  });

  it('resets to 0 when the calendar day rolls over', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T23:00:00Z'));
    const { X402Stats } = await import('../../src/server/security/x402-stats.js');
    const stats = X402Stats.getInstance();

    stats.recordSettled('cdp', '0xabc', '0xtx1', '/x402/fx-rate');
    stats.recordSettled('cdp', '0xabc', '0xtx2', '/x402/gas-tracker');
    expect(stats.getPaidToday()).toBe(2);

    // Cross midnight.
    vi.setSystemTime(new Date('2026-08-04T00:05:00Z'));
    expect(stats.getPaidToday()).toBe(0); // getPaidToday() itself detects the rollover

    stats.recordSettled('cdp', '0xabc', '0xtx3', '/x402/fx-rate');
    expect(stats.getPaidToday()).toBe(1); // fresh day, fresh count
  });
});

describe('X402Stats snapshot().distinctRecentPayers', () => {
  it('reports 0 distinct payers and an honest note when nothing has settled yet', async () => {
    const { X402Stats } = await import('../../src/server/security/x402-stats.js');
    const stats = X402Stats.getInstance();
    const snap = stats.snapshot();
    expect(snap['distinctRecentPayers']).toBe(0);
    expect(String(snap['distinctRecentPayersNote'])).toContain('no settled payments yet');
  });

  it('reports exactly 1 distinct payer and flags it plainly when every settled call came from the same wallet (the self-seeding pattern)', async () => {
    const { X402Stats } = await import('../../src/server/security/x402-stats.js');
    const stats = X402Stats.getInstance();
    for (let i = 0; i < 5; i++) {
      stats.recordSettled('cdp', '0xSameWalletEveryTime', `0xtx${i}`, '/x402/fx-rate');
    }
    const snap = stats.snapshot();
    expect(snap['distinctRecentPayers']).toBe(1);
    const note = String(snap['distinctRecentPayersNote']);
    expect(note).toContain('SAME wallet');
    expect(note).toContain('not diverse organic traffic');
  });

  it('reports the real distinct count when different wallets actually paid', async () => {
    const { X402Stats } = await import('../../src/server/security/x402-stats.js');
    const stats = X402Stats.getInstance();
    stats.recordSettled('cdp', '0xWalletA', '0xtx1', '/x402/fx-rate');
    stats.recordSettled('cdp', '0xWalletB', '0xtx2', '/x402/fx-rate');
    stats.recordSettled('cdp', '0xWalletC', '0xtx3', '/x402/fx-rate');
    stats.recordSettled('cdp', '0xWalletA', '0xtx4', '/x402/fx-rate'); // A pays again
    const snap = stats.snapshot();
    expect(snap['distinctRecentPayers']).toBe(3);
    expect(String(snap['distinctRecentPayersNote'])).toContain('3 distinct wallets');
  });
});
