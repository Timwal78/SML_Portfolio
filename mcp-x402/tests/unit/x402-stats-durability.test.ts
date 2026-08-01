import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Regression test for the x402-stats durability fix (found 2026-08-01 while
 * diagnosing "why has this product had zero stranger purchases in 5
 * months" — the operator pulled /x402/stats and it showed uptimeSeconds=373
 * and all-zero counters, which turned out to prove nothing: the module only
 * ever persisted to /tmp/x402-stats.json, which does NOT survive a Render
 * redeploy (a fresh container gets a fresh /tmp), so the "all-time" counter
 * was silently resetting on every single deploy this whole time — the same
 * "local JSON fallback doesn't survive redeploy" gap already documented for
 * equivalent modules elsewhere in this account). X402Stats now persists to
 * Redis when REDIS_URL is configured, which does survive a redeploy.
 *
 * X402Stats is a singleton cached at module scope — vi.resetModules() +
 * a fresh dynamic import gives each test a clean instance, matching this
 * codebase's own class design (no test-only reset hook was added to the
 * class itself, keeping production code unchanged for testing's sake).
 */

const mockRedisState = {
  store: new Map<string, string>(),
  shouldFailConnect: false,
};

vi.mock('redis', () => ({
  createClient: vi.fn(() => ({
    on: vi.fn(),
    connect: vi.fn(async () => {
      if (mockRedisState.shouldFailConnect) throw new Error('connect failed');
    }),
    get: vi.fn(async (key: string) => mockRedisState.store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      mockRedisState.store.set(key, value);
      return 'OK';
    }),
  })),
}));

// Each test gets its own scratch file, deleted before AND after — the real
// default (/tmp/x402-stats.json) must never be touched by this suite, or
// state leaks across separate `vitest run` invocations on real disk (this
// is exactly the class of bug this fix addresses, so the test itself must
// not fall into it).
function scratchStatsPath(): string {
  return join(tmpdir(), `x402-stats-test-${Math.random().toString(36).slice(2)}.json`);
}
let currentScratchPath: string;

beforeEach(() => {
  vi.resetModules();
  mockRedisState.store.clear();
  mockRedisState.shouldFailConnect = false;
  delete process.env['REDIS_URL'];
  currentScratchPath = scratchStatsPath();
  process.env['X402_STATS_FILE'] = currentScratchPath;
});

afterEach(() => {
  delete process.env['REDIS_URL'];
  if (currentScratchPath && existsSync(currentScratchPath)) unlinkSync(currentScratchPath);
  delete process.env['X402_STATS_FILE'];
});

// Give the fire-and-forget async Redis init a tick to resolve.
async function flushMicrotasks() {
  await new Promise((r) => setTimeout(r, 10));
}

describe('X402Stats durability', () => {
  it('falls back to local_json_ephemeral when REDIS_URL is unset — unchanged prior behavior', async () => {
    const { X402Stats } = await import('../../src/server/security/x402-stats.js');
    const stats = X402Stats.getInstance();
    await flushMicrotasks();
    const snap = stats.snapshot();
    expect(snap['backend']).toBe('local_json_ephemeral');
    expect(snap['statsFile']).toBeTruthy();
  });

  it('uses redis and reports backend:"redis" when REDIS_URL is configured', async () => {
    process.env['REDIS_URL'] = 'redis://localhost:6379';
    const { X402Stats } = await import('../../src/server/security/x402-stats.js');
    const stats = X402Stats.getInstance();
    await flushMicrotasks();
    const snap = stats.snapshot();
    expect(snap['backend']).toBe('redis');
  });

  it('persists a real settled event to redis and it is readable back after a fresh process (simulated redeploy)', async () => {
    process.env['REDIS_URL'] = 'redis://localhost:6379';
    const { X402Stats } = await import('../../src/server/security/x402-stats.js');
    const stats = X402Stats.getInstance();
    await flushMicrotasks();

    stats.recordSettled('cdp', '0xabc123', '0xdeadbeef', 'mcp-tool:leviathan_signal');
    // force flush is on an interval; call the private path indirectly by
    // recording another event, which triggers touch()->flush() synchronously
    // (the redis .set() call itself is fire-and-forget, so give it a tick).
    await flushMicrotasks();

    expect(stats.getAiAgentsAllTime()).toBe(1);
    expect(mockRedisState.store.has('x402stats:snapshot')).toBe(true);
    const persisted = JSON.parse(mockRedisState.store.get('x402stats:snapshot')!);
    expect(persisted.aiAgentsAllTime).toBe(1);
    expect(persisted.settledByFacilitator.cdp).toBe(1);

    // Simulate a redeploy: reset modules, get a brand-new singleton, same
    // (mocked) Redis store as the "surviving" backend.
    vi.resetModules();
    const { X402Stats: FreshStats } = await import('../../src/server/security/x402-stats.js');
    const freshInstance = FreshStats.getInstance();
    await flushMicrotasks();
    expect(freshInstance.getAiAgentsAllTime()).toBe(1);
  });

  it('falls back gracefully to local_json_ephemeral if the Redis connection fails, without crashing', async () => {
    process.env['REDIS_URL'] = 'redis://localhost:6379';
    mockRedisState.shouldFailConnect = true;
    const { X402Stats } = await import('../../src/server/security/x402-stats.js');
    const stats = X402Stats.getInstance();
    await flushMicrotasks();
    const snap = stats.snapshot();
    expect(snap['backend']).toBe('local_json_ephemeral');
    // Still fully functional despite Redis being unreachable.
    stats.recordSettled('x402.org', '0xabc', '0xtx', 'mcp-tool:crawl_paid_fetch');
    expect(stats.getAiAgentsAllTime()).toBe(1);
  });
});
