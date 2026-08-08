/**
 * Free MCP tools: get_beacon_score + get_beacon_passport
 *
 * MCP-callable wrappers over the REST /beacon/score and /beacon/passport
 * routes (see amb/beacon-routes.ts) — added so agents using MCP JSON-RPC
 * have the same parity every other AMB capability already has (list_magnets/
 * get_agent_magnet_beacons wrap /.well-known/amb.json the same way). Reuses
 * the exact same real data — no separate scoring logic here.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { getCachedBeacons } from '../amb/amb-routes.js';
import { SAFE_PAY_TO, MULTI_RAILS } from '../amb/amb-generator.js';
import { X402Stats } from '../security/x402-stats.js';

const ScoreSchema = z.object({
  tool: z.string().min(1).optional().describe('Tool name to score. Omit to list every real BEACON Score.'),
});

const PassportSchema = z.object({
  tool: z.string().min(1).optional().describe('Tool name for a per-tool passport. Omit for the full provider passport.'),
});

function scoreForBeacon(b: ReturnType<typeof getCachedBeacons>[number]) {
  return {
    tool_name: b.tool_name,
    beacon_score: b.imp_score,
    magnet_strength: b.magnet_strength,
    price: b.payment.price,
    free_tier: b.free_tier,
    performance: b.performance,
    reputation: b.reputation,
    data_quality: b.data_quality,
    endpoint: b.endpoint,
  };
}

export function registerBeacon(server: McpServer): void {
  const audit = AuditLogger.getInstance();

  server.tool(
    'get_beacon_score',
    {
      tool: z.string().min(1).optional().describe('Tool name to score. Omit to list every real BEACON Score.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(ScoreSchema, rawArgs ?? {});
      if (!RateLimiter.getInstance().checkTool('get_beacon_score')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      try {
        const beacons = getCachedBeacons();
        if (args.tool) {
          const b = beacons.find((x) => x.tool_name === args.tool);
          if (!b) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'unknown_tool', tool: args.tool }) }], isError: true };
          }
          audit.info('get_beacon_score', { tool: args.tool });
          return { content: [{ type: 'text', text: JSON.stringify({ free: true, ...scoreForBeacon(b), as_of: new Date().toISOString() }) }] };
        }
        const scored = beacons.map(scoreForBeacon).sort((a, b) => b.beacon_score - a.beacon_score);
        audit.info('get_beacon_score', { count: scored.length });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                free: true,
                count: scored.length,
                measured_count: scored.filter((s) => s.data_quality.confidence === 'measured').length,
                scores: scored,
                as_of: new Date().toISOString(),
              }),
            },
          ],
        };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'beacon_score_error', message: String(err) }) }], isError: true };
      }
    },
  );

  server.tool(
    'get_beacon_passport',
    {
      tool: z.string().min(1).optional().describe('Tool name for a per-tool passport. Omit for the full provider passport.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(PassportSchema, rawArgs ?? {});
      if (!RateLimiter.getInstance().checkTool('get_beacon_passport')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      try {
        const beacons = getCachedBeacons();
        if (args.tool) {
          const b = beacons.find((x) => x.tool_name === args.tool);
          if (!b) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'unknown_tool', tool: args.tool }) }], isError: true };
          }
          audit.info('get_beacon_passport', { tool: args.tool });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  free: true,
                  tool_name: b.tool_name,
                  description: b.description,
                  capabilities: b.capabilities,
                  endpoint: b.endpoint,
                  price: b.payment.price,
                  free_tier: b.free_tier,
                  networks: [...MULTI_RAILS],
                  performance: b.performance,
                  reputation: b.reputation,
                  data_quality: b.data_quality,
                  attestations: { count: 0, items: [], note: 'No attestation infrastructure exists yet.' },
                  risk_policies: { note: 'Not implemented.' },
                  supported_agent_protocols: ['x402', 'MCP (Model Context Protocol)', 'Virtuals ACP'],
                  as_of: new Date().toISOString(),
                }),
              },
            ],
          };
        }
        const statsSnapshot = X402Stats.getInstance().snapshot() as { settledByRoute?: Record<string, number>; failedByRoute?: Record<string, number>; backend?: string };
        const settledByRoute = statsSnapshot.settledByRoute ?? {};
        const failedByRoute = statsSnapshot.failedByRoute ?? {};
        const totalSettled = Object.values(settledByRoute).reduce((a, b) => a + b, 0);
        const totalFailed = Object.values(failedByRoute).reduce((a, b) => a + b, 0);
        audit.info('get_beacon_passport', { count: beacons.length });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                free: true,
                provider: { name: 'scriptmasterlabs', wallet: SAFE_PAY_TO },
                capabilities: beacons.map((b) => ({
                  tool_name: b.tool_name,
                  description: b.description,
                  price: b.payment.price,
                  beacon_score: b.imp_score,
                  data_quality: b.data_quality,
                })),
                networks: [...MULTI_RAILS],
                payment_history: {
                  settlements_alltime: totalSettled,
                  failed_attempts_alltime: totalFailed,
                  backend: statsSnapshot.backend,
                  note: 'Cumulative since process start. Real counts only.',
                },
                attestations: { count: 0, items: [], note: 'No attestation infrastructure exists yet.' },
                risk_policies: { note: 'Not implemented.' },
                supported_agent_protocols: ['x402', 'MCP (Model Context Protocol)', 'Virtuals ACP'],
                as_of: new Date().toISOString(),
              }),
            },
          ],
        };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'beacon_passport_error', message: String(err) }) }], isError: true };
      }
    },
  );
}
