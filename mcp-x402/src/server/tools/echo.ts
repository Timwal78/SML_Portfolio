import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { PriceRegistry } from '../registry/pricing.js';
import { EchoForgeAPI } from '../../lib/sml-api/echo.js';

const PatternMatchSchema = z.object({
  symbol: z.string().min(1).max(10).toUpperCase(),
  lookback_days: z.number().int().min(1).max(3650),
  top_n: z.number().int().min(1).max(20).default(5),
  wallet_address: z.string().optional(),
});

export function registerEcho(server: McpServer): void {
  const audit = AuditLogger.getInstance();

  // ── PAID: echo_pattern_match (0.05 USDC — coming soon) ────────────────────
  server.tool(
    'echo_pattern_match',
    {
      symbol: z.string().describe('Ticker symbol to find historical analogs for (e.g. TSLA, GME).'),
      lookback_days: z.number().describe('Days of price history to encode as the query pattern (1-3650).'),
      top_n: z.number().describe('Number of closest historical matches to return (1-20, default 5).'),
      wallet_address: z.string().describe('Agent wallet for x402 payment.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(PatternMatchSchema, rawArgs);

      if (!RateLimiter.getInstance().checkTool('echo_pattern_match')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }

      // Service not yet deployed — skip payment and return informative stub
      const data = await EchoForgeAPI.patternMatch({
        symbol: args.symbol,
        lookbackDays: args.lookback_days,
        topN: args.top_n,
        walletAddress: args.wallet_address ?? 'anonymous',
      });

      audit.info('echo_pattern_match_stub', { symbol: args.symbol });

      // Still go through payment flow once the service is live — skeleton already wired:
      // const price = await PriceRegistry.getInstance().getPrice('echo_pattern_match');
      // payment = await executeX402Payment(...);
      // Then call real API

      // Suppress unused import warnings until service goes live
      void executeX402Payment;
      void PriceRegistry;

      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    },
  );
}
