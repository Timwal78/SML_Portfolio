/**
 * Free MCP tools: list_magnets + get_agent_magnet_beacons
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { getCachedAmbDocument, getCachedBeacons } from '../amb/amb-routes.js';
import { SAFE_PAY_TO } from '../amb/amb-generator.js';

const ListSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  min_strength: z.number().min(0).max(1).optional(),
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
        .describe('Minimum magnet_strength filter 0-1.'),
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
        const doc = getCachedAmbDocument();
        let beacons = getCachedBeacons();
        if (args.min_strength != null) {
          beacons = beacons.filter((b) => b.magnet_strength >= args.min_strength!);
        }
        const limit = args.limit ?? 25;
        beacons = beacons.slice(0, limit);
        audit.info('list_magnets', { count: beacons.length, pay_to: SAFE_PAY_TO });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                free: true,
                count: beacons.length,
                pay_to: doc.pay_to,
                rails: doc.rails,
                top_magnet: doc.top_magnet,
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
        const doc = getCachedAmbDocument();
        const out =
          args.limit != null
            ? { ...doc, beacons: doc.beacons.slice(0, args.limit), count: Math.min(doc.count, args.limit) }
            : doc;
        audit.info('get_agent_magnet_beacons', { count: out.count });
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
