/**
 * Free MCP tools: list_magnets + get_agent_magnet_beacons
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { getCachedAmbDocument, getCachedBeacons, getLiveAmbDocument } from '../amb/amb-routes.js';
import { SAFE_PAY_TO } from '../amb/amb-generator.js';
import { recordAmbTraffic } from '../amb/amb-traffic.js';

const ListSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  min_strength: z.number().min(0).max(1).optional(),
  min_imp_score: z.number().min(0).max(1).optional(),
  sort: z.enum(['imp_score', 'magnet_strength']).optional(),
});

const FullSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
});

export function registerMagnets(server: McpServer): void {
  const audit = AuditLogger.getInstance();

  server.tool(
    'list_magnets',
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe('Max beacons to return (default 25).'),
      min_strength: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe('Minimum magnet_strength filter 0-1 (legacy).'),
      min_imp_score: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe('Minimum IMP imp_score filter 0-1 (preferred).'),
      sort: z
        .enum(['imp_score', 'magnet_strength'])
        .optional()
        .describe('Rank key (default imp_score).'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(ListSchema, rawArgs ?? {});
      if (!RateLimiter.getInstance().checkTool('list_magnets')) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }),
            },
          ],
          isError: true,
        };
      }
      try {
        recordAmbTraffic('list_magnets', 'mcp-tool');
        const doc = getLiveAmbDocument();
        let beacons = [...getCachedBeacons()];
        const sortKey = args.sort ?? 'imp_score';
        const rank = (b: (typeof beacons)[number]) =>
          sortKey === 'magnet_strength'
            ? b.magnet_strength
            : (b.imp_score ?? b.magnet_strength);
        // free first, then paid by IMP score
        const free = beacons.filter((b) => b.free_tier);
        let paid = beacons.filter((b) => !b.free_tier);
        if (args.min_strength != null) {
          paid = paid.filter((b) => b.magnet_strength >= args.min_strength!);
        }
        if (args.min_imp_score != null) {
          paid = paid.filter((b) => (b.imp_score ?? b.magnet_strength) >= args.min_imp_score!);
        }
        paid = paid.sort((a, b) => rank(b) - rank(a));
        beacons = [...free, ...paid];
        const limit = args.limit ?? 25;
        beacons = beacons.slice(0, limit);
        audit.info('list_magnets', {
          count: beacons.length,
          pay_to: SAFE_PAY_TO,
          agents_24h: doc.traffic.unique_agents,
          sort: sortKey,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                free: true,
                count: beacons.length,
                sort: sortKey,
                ranking: 'imp_score (IMP v0.1 multi-rail); free beacons first',
                imp_version: (doc as { imp_version?: string }).imp_version || '0.1.0',
                formula: (doc as { formula?: string }).formula,
                pay_to: doc.pay_to,
                rails: doc.rails,
                top_magnet: doc.top_magnet,
                traffic: doc.traffic,
                agent_tracker: doc.agent_tracker,
                beacons,
                full_document: doc.discovery.amb,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: 'amb_error', message: String(err) }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'get_agent_magnet_beacons',
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe('Optional max paid+free beacons in the set.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(FullSchema, rawArgs ?? {});
      if (!RateLimiter.getInstance().checkTool('get_agent_magnet_beacons')) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }),
            },
          ],
          isError: true,
        };
      }
      try {
        recordAmbTraffic('get_agent_magnet_beacons', 'mcp-tool');
        const doc = getLiveAmbDocument();
        const out =
          args.limit != null
            ? { ...doc, beacons: doc.beacons.slice(0, args.limit), count: Math.min(doc.count, args.limit) }
            : doc;
        audit.info('get_agent_magnet_beacons', { count: out.count, agents_24h: doc.traffic.unique_agents });
        return {
          content: [{ type: 'text', text: JSON.stringify(out) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: 'amb_error', message: String(err) }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
