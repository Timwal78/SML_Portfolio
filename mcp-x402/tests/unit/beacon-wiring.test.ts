import { describe, it, expect, vi } from 'vitest';

/**
 * Regression tests for "wire it up" follow-through on the BEACON Score/
 * Passport endpoints (2026-08-08): every AMB beacon now links to its real
 * BEACON Score/Passport, the top-level AMB discovery block links to the
 * list endpoints, and MCP tool wrappers exist for JSON-RPC parity with
 * every other AMB capability (list_magnets/get_agent_magnet_beacons).
 */

describe('AMB beacon links include BEACON discovery', () => {
  it('every beacon carries real, per-tool beacon_score/beacon_passport links', async () => {
    const { defaultMagnetCatalog, generateAMB } = await import('../../src/server/amb/amb-generator.js');
    const catalog = defaultMagnetCatalog();
    expect(catalog.length).toBeGreaterThan(0);
    for (const input of catalog) {
      const beacon = generateAMB(input);
      expect(beacon.links.beacon_score).toBe(`https://mcp-x402.onrender.com/beacon/score/${input.toolName}`);
      expect(beacon.links.beacon_passport).toBe(`https://mcp-x402.onrender.com/beacon/passport/${input.toolName}`);
    }
  });

  it('buildAmbDocument\'s top-level discovery block links to the list endpoints', async () => {
    const { buildAmbDocument } = await import('../../src/server/amb/amb-generator.js');
    const doc = buildAmbDocument('https://mcp-x402.onrender.com');
    expect(doc.discovery['beacon_scores']).toBe('https://mcp-x402.onrender.com/beacon/scores');
    expect(doc.discovery['beacon_passport']).toBe('https://mcp-x402.onrender.com/beacon/passport');
  });
});

// Minimal fake McpServer — captures registered tool handlers by name so
// they can be invoked directly, without needing the real MCP SDK transport.
interface CapturedTool {
  name: string;
  handler: (args: unknown) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
}
function fakeServer() {
  const tools: CapturedTool[] = [];
  return {
    tool: (name: string, _schema: unknown, handler: CapturedTool['handler']) => {
      tools.push({ name, handler });
    },
    get: (name: string) => tools.find((t) => t.name === name),
  };
}

describe('registerBeacon MCP tools — real parity with the REST endpoints', () => {
  it('get_beacon_score with no args returns the same real scores as the REST list', async () => {
    vi.resetModules();
    const { registerBeacon } = await import('../../src/server/tools/beacon.js');
    const { getCachedBeacons } = await import('../../src/server/amb/amb-routes.js');
    const server = fakeServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerBeacon(server as any);
    const tool = server.get('get_beacon_score')!;
    const result = await tool.handler({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.free).toBe(true);
    expect(Array.isArray(parsed.scores)).toBe(true);
    expect(parsed.scores.length).toBe(getCachedBeacons().length);
    for (const s of parsed.scores) {
      expect(s).toHaveProperty('data_quality');
    }
  });

  it('get_beacon_score with an unknown tool returns unknown_tool, not a fabricated score', async () => {
    const { registerBeacon } = await import('../../src/server/tools/beacon.js');
    const server = fakeServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerBeacon(server as any);
    const tool = server.get('get_beacon_score')!;
    const result = await tool.handler({ tool: 'not_a_real_tool_xyz' });
    const parsed = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(parsed.error).toBe('unknown_tool');
  });

  it('get_beacon_passport with no args discloses attestations/risk_policies honestly, same as the REST endpoint', async () => {
    const { registerBeacon } = await import('../../src/server/tools/beacon.js');
    const server = fakeServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerBeacon(server as any);
    const tool = server.get('get_beacon_passport')!;
    const result = await tool.handler({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.attestations.count).toBe(0);
    expect(parsed.risk_policies.note).toMatch(/not implemented/i);
    expect(typeof parsed.payment_history.settlements_alltime).toBe('number');
  });

  it('both tools are registered by registerTools() (real wiring, not just a standalone module)', async () => {
    const { registerTools } = await import('../../src/server/tools/index.js');
    const server = fakeServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await registerTools(server as any);
    expect(server.get('get_beacon_score')).toBeDefined();
    expect(server.get('get_beacon_passport')).toBeDefined();
  });
});
