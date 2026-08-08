import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Regression tests for beacon_scout v2 — redefined by operator directive
 * (2026-08-08) from a shopping-comparison tool into an outbound "agent
 * magnet" report: real proof strangers/AI agents are finding and paying
 * SML, real reachability of SML's own discovery surface, and a real,
 * named list of external discovery targets worth pursuing.
 *
 * fetch is mocked throughout — this module makes real outbound network
 * calls (to SML's own discovery endpoints AND external sites like
 * x402scan.com), which must never run unmocked in a test suite.
 */

function scratchStatsPath(): string {
  return join(tmpdir(), `x402-stats-scout-test-${Math.random().toString(36).slice(2)}.json`);
}
let currentScratchPath: string;

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  delete process.env['REDIS_URL'];
  currentScratchPath = scratchStatsPath();
  process.env['X402_STATS_FILE'] = currentScratchPath;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (currentScratchPath && existsSync(currentScratchPath)) unlinkSync(currentScratchPath);
  delete process.env['X402_STATS_FILE'];
});

describe('getScoutReport — sign (own discovery surface)', () => {
  it('reports all_reachable true when every own-surface check returns ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const { getScoutReport } = await import('../../src/server/tools/beacon-scout.js');
    const report = await getScoutReport('https://mcp-x402.onrender.com');
    expect(report.sign.all_reachable).toBe(true);
    expect(report.sign.checks.length).toBe(5);
    for (const c of report.sign.checks) {
      expect(c.reachable).toBe(true);
      expect(c.status).toBe(200);
    }
  });

  it('distinguishes a real non-2xx response (reachable:false) from a network failure (reachable:null)', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      call += 1;
      if (String(url).includes('llms.txt')) return new Response('not found', { status: 404 });
      if (String(url).includes('agentcard.json')) throw new Error('network unreachable');
      return new Response('{}', { status: 200 });
    }));
    const { getScoutReport } = await import('../../src/server/tools/beacon-scout.js');
    const report = await getScoutReport('https://mcp-x402.onrender.com');
    const llms = report.sign.checks.find((c) => c.name === 'llms.txt')!;
    const agentcard = report.sign.checks.find((c) => c.name === 'Agent card')!;
    expect(llms.reachable).toBe(false);
    expect(llms.status).toBe(404);
    expect(agentcard.reachable).toBeNull();
    expect(agentcard.status).toBeNull();
    expect(report.sign.all_reachable).toBe(false);
    expect(call).toBeGreaterThan(0);
  });
});

describe('getScoutReport — attraction (real traffic + payment proof)', () => {
  it('reflects real recorded AMB traffic, not a projected number', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const { recordAmbTraffic } = await import('../../src/server/amb/amb-traffic.js');
    recordAmbTraffic('amb_fetch', 'agent-a');
    recordAmbTraffic('amb_fetch', 'agent-b');
    recordAmbTraffic('paid_call', 'agent-a');
    const { getScoutReport } = await import('../../src/server/tools/beacon-scout.js');
    const report = await getScoutReport();
    expect(report.attraction.amb_fetches_24h).toBeGreaterThanOrEqual(2);
    expect(report.attraction.paid_calls_24h).toBeGreaterThanOrEqual(1);
    expect(report.attraction.unique_agents_24h).toBeGreaterThanOrEqual(2);
  });

  it('reflects real X402Stats settlement/payer data, not fabricated', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const { X402Stats } = await import('../../src/server/security/x402-stats.js');
    const stats = X402Stats.getInstance();
    stats.recordSettled('cdp', '0xSameWallet', '0xtx1', '/x402/gas-tracker');
    stats.recordSettled('cdp', '0xSameWallet', '0xtx2', '/x402/gas-tracker');
    const { getScoutReport } = await import('../../src/server/tools/beacon-scout.js');
    const report = await getScoutReport();
    expect(report.attraction.settlements_alltime).toBeGreaterThanOrEqual(2);
    expect(report.attraction.distinct_recent_payers).toBe(1);
    expect(report.attraction.distinct_recent_payers_note).toMatch(/SAME wallet/i);
  });
});

describe('getScoutReport — go_get_found (external discovery targets)', () => {
  it('lists real, named discovery targets with a live reachability check, never a fabricated "listed" claim', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const { getScoutReport } = await import('../../src/server/tools/beacon-scout.js');
    const report = await getScoutReport();
    const names = report.go_get_found.targets.map((t) => t.name);
    expect(names).toContain('x402scan');
    expect(names).toContain('agent402.tools');
    expect(names).toContain('Smithery.ai');
    for (const t of report.go_get_found.targets) {
      expect(t).not.toHaveProperty('listed'); // never claims a confirmed listing — only reachability
      expect(['boolean', 'object']).toContain(typeof t.reachable); // boolean or null
    }
    expect(report.go_get_found.note).toMatch(/not.*confirmed-listed/i);
  });
});

describe('registerBeaconScout MCP tool', () => {
  interface CapturedTool {
    name: string;
    handler: (args: unknown) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
  }
  function fakeServer() {
    const tools: CapturedTool[] = [];
    return {
      tool: (name: string, _desc: unknown, _schema: unknown, handler: CapturedTool['handler']) => {
        tools.push({ name, handler });
      },
      get: (name: string) => tools.find((t) => t.name === name),
    };
  }

  it('is registered and returns the same real report shape as getScoutReport', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const { registerBeaconScout } = await import('../../src/server/tools/beacon-scout.js');
    const server = fakeServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerBeaconScout(server as any);
    const tool = server.get('beacon_scout');
    expect(tool).toBeDefined();
    const result = await tool!.handler({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.free).toBe(true);
    expect(parsed.sign).toBeDefined();
    expect(parsed.attraction).toBeDefined();
    expect(parsed.go_get_found).toBeDefined();
  });

  it('is registered by registerTools() (real wiring, not just standalone)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const { registerTools } = await import('../../src/server/tools/index.js');
    const server = fakeServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await registerTools(server as any);
    expect(server.get('beacon_scout')).toBeDefined();
  });
});
