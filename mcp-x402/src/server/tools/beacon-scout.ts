/**
 * beacon_scout — item #4 from the original BEACON pitch, redefined by
 * operator directive (2026-08-08) after the first draft got the direction
 * backwards: this is NOT a shopping agent that buys other providers'
 * APIs. It's an outbound "agent magnet" report — the front door with the
 * bright sign, proving real strangers and AI agents are actually finding
 * and paying ScriptMasterLabs, and pointing at where to go get found next.
 *
 * Three real, honest components — nothing here is projected or seeded:
 *
 * 1. sign — is SML's own discovery surface actually reachable right now?
 *    Real HTTP checks against amb.json/x402/agentcard.json/llms.txt/
 *    beacon/scores. "reachable: null" means the check itself failed
 *    (network/timeout), which is honestly distinct from a real 404/500.
 * 2. attraction — real, already-tracked traffic and payment data
 *    (amb-traffic.ts, X402Stats) surfaced in one place instead of
 *    scattered across separate endpoints nobody reads together. This is
 *    the actual proof: unique agents, paid calls, distinct payers.
 * 3. go_get_found — a real, named list of discovery surfaces relevant to
 *    an MCP/x402 server (x402scan, agent402.tools — already referenced in
 *    this repo's own llms.txt, MCP registries), with a live reachability
 *    check. This is NOT a confirmed-listed status — actually confirming
 *    SML is listed on each site needs a per-site check this v1 doesn't
 *    build (same honest distinction SqueezeOS's Directory Ranger already
 *    draws between "reachable" and "audited as listed"). Treat this as a
 *    to-do list, not a scoreboard.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RateLimiter } from '../security/rate-limit.js';
import { AuditLogger } from '../security/audit.js';
import { getAmbTrafficSnapshot } from '../amb/amb-traffic.js';
import { X402Stats } from '../security/x402-stats.js';

export interface SurfaceCheck {
  name: string;
  url: string;
  category?: string;
  /** true = real 2xx/3xx, false = real non-2xx response, null = the check itself failed (network/timeout) — never fabricated. */
  reachable: boolean | null;
  status: number | null;
  latency_ms: number;
}

async function checkUrl(name: string, url: string, category?: string, timeoutMs = 8000): Promise<SurfaceCheck> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined });
    return { name, url, category, reachable: res.ok, status: res.status, latency_ms: Date.now() - t0 };
  } catch {
    return { name, url, category, reachable: null, status: null, latency_ms: Date.now() - t0 };
  }
}

function ownSurface(base: string): Array<{ name: string; url: string }> {
  return [
    { name: 'AMB manifest', url: `${base}/.well-known/amb.json` },
    { name: 'x402 discovery', url: `${base}/.well-known/x402` },
    { name: 'Agent card', url: `${base}/.well-known/agentcard.json` },
    { name: 'llms.txt', url: `${base}/llms.txt` },
    { name: 'BEACON Scores', url: `${base}/beacon/scores` },
  ];
}

/**
 * Real, named discovery surfaces relevant to an MCP/x402 server.
 * agent402.tools is already referenced in this repo's own llms.txt
 * ("list on agent402.tools/sell") as a target SML hasn't confirmed it's
 * on — not invented for this feature. The MCP registries mirror the same
 * real list SqueezeOS's own Directory Ranger already checks elsewhere in
 * this account, scoped down to the entries actually relevant to an
 * MCP/x402 server rather than SqueezeOS's broader AI-tool audience.
 */
const EXTERNAL_TARGETS: Array<{ name: string; url: string; category: string }> = [
  { name: 'x402scan', url: 'https://x402scan.com', category: 'x402 Marketplace' },
  { name: 'agent402.tools', url: 'https://agent402.tools', category: 'x402 Marketplace' },
  { name: 'Smithery.ai', url: 'https://smithery.ai', category: 'MCP Registry' },
  { name: 'Glama.ai', url: 'https://glama.ai', category: 'MCP Registry' },
  { name: 'mcp.so', url: 'https://mcp.so', category: 'MCP Registry' },
  { name: 'PulseMCP', url: 'https://pulsemcp.com', category: 'MCP Registry' },
  { name: 'mcp.run', url: 'https://mcp.run', category: 'MCP Registry' },
];

export async function getScoutReport(baseUrl?: string) {
  const base = (baseUrl || process.env['PUBLIC_BASE_URL'] || 'https://mcp-x402.onrender.com').replace(/\/$/, '');

  const [ownChecks, externalChecks] = await Promise.all([
    Promise.all(ownSurface(base).map((s) => checkUrl(s.name, s.url))),
    Promise.all(EXTERNAL_TARGETS.map((t) => checkUrl(t.name, t.url, t.category))),
  ]);

  const traffic = getAmbTrafficSnapshot();
  const statsSnapshot = X402Stats.getInstance().snapshot() as {
    settledByRoute?: Record<string, number>;
    paidToday?: number;
    distinctRecentPayers?: number;
    distinctRecentPayersNote?: string;
    backend?: string;
  };
  const settlementsAllTime = Object.values(statsSnapshot.settledByRoute ?? {}).reduce((a, b) => a + b, 0);

  return {
    sign: {
      note: 'Is the front door actually lit up — are SML\'s own discovery documents reachable right now?',
      all_reachable: ownChecks.every((c) => c.reachable === true),
      checks: ownChecks,
    },
    attraction: {
      note: 'Real proof strangers/AI agents are finding and paying SML — not projected, not seeded. See distinct_recent_payers_note for a same-wallet-vs-diverse-payer read.',
      unique_agents_24h: traffic.unique_agents,
      amb_fetches_24h: traffic.amb_fetches,
      list_magnets_24h: traffic.list_magnets_calls,
      paid_calls_24h: traffic.paid_calls,
      paid_today: statsSnapshot.paidToday ?? 0,
      distinct_recent_payers: statsSnapshot.distinctRecentPayers ?? 0,
      distinct_recent_payers_note: statsSnapshot.distinctRecentPayersNote ?? null,
      settlements_alltime: settlementsAllTime,
      stats_backend: statsSnapshot.backend,
    },
    go_get_found: {
      note: 'Real, named discovery targets for an MCP/x402 server, with a live reachability check — NOT a confirmed-listed status (that needs a manual per-site check, same distinction Directory Ranger already draws elsewhere). A to-do list, not a scoreboard.',
      targets: externalChecks,
    },
    as_of: new Date().toISOString(),
  };
}

export function registerBeaconScout(server: McpServer): void {
  const audit = AuditLogger.getInstance();

  server.tool(
    'beacon_scout',
    'FREE. The agent-magnet report: proves whether SML is actually being discovered and paid by real strangers/AI agents right now (real traffic + payment data, not projected), confirms SML\'s own discovery surface is reachable, and lists real, named external discovery targets worth getting listed on.',
    {},
    async (): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: true }> => {
      if (!RateLimiter.getInstance().checkTool('beacon_scout')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      try {
        const report = await getScoutReport();
        audit.info('beacon_scout', { all_reachable: report.sign.all_reachable, unique_agents_24h: report.attraction.unique_agents_24h });
        return { content: [{ type: 'text', text: JSON.stringify({ free: true, ...report }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'beacon_scout_error', message: String(err) }) }], isError: true };
      }
    },
  );
}
