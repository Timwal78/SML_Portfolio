import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { FtdClient } from '../../lib/sml-api/ftd.js';
import { PriceRegistry } from '../registry/pricing.js';

const CACHE_TTL_MS = 15 * 60 * 1000; // 15-min cache per spec

interface CacheEntry {
  data: unknown;
  ts: number;
}

const alertCache = new Map<string, CacheEntry>();
const fullCache = new Map<string, CacheEntry>();

const InputSchema = z.object({
  scan_type: z.enum(['alerts', 'full', 'spike_history']),
  ticker: z.string().regex(/^[A-Z]{1,5}$/).optional(),
  min_spike_multiplier: z.number().min(1).default(2),
  wallet_address: z.string().optional(),
});

export function registerFtd(server: McpServer): void {
  server.tool(
    'ftd_threshold_scan',
    {
      scan_type: { type: 'string', enum: ['alerts', 'full', 'spike_history'], description: '"alerts" is free. "full" and "spike_history" require 0.05 USDC.' },
      ticker: { type: 'string', description: 'Filter by ticker. Optional.' },
      min_spike_multiplier: { type: 'number', description: 'Minimum FTD spike multiplier vs baseline. Default: 2x.' },
      wallet_address: { type: 'string', description: 'Agent wallet for paid scans.' },
    },
    async (rawArgs) => {
      const args = Sandbox.validate(InputSchema, rawArgs);
      const audit = AuditLogger.getInstance();

      if (!RateLimiter.getInstance().checkTool('ftd_threshold_scan')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded' }) }], isError: true };
      }

      const cacheKey = `${args.scan_type}:${args.ticker ?? 'all'}:${args.min_spike_multiplier}`;
      const now = Date.now();

      // Free tier: alerts only
      if (args.scan_type === 'alerts') {
        const cached = alertCache.get(cacheKey);
        if (cached && now - cached.ts < CACHE_TTL_MS) {
          return { content: [{ type: 'text', text: JSON.stringify({ data: cached.data, cached: true, tier: 'free' }) }] };
        }

        const client = FtdClient.getInstance();
        const data = await client.getAlerts({ ticker: args.ticker, minSpikeMultiplier: args.min_spike_multiplier });
        alertCache.set(cacheKey, { data, ts: now });
        audit.info('ftd_alert_success', { ticker: args.ticker ?? 'all' });
        return { content: [{ type: 'text', text: JSON.stringify({ data, tier: 'free' }) }] };
      }

      // Paid tier: full data
      const cached = fullCache.get(cacheKey);
      if (cached && now - cached.ts < CACHE_TTL_MS) {
        return { content: [{ type: 'text', text: JSON.stringify({ data: cached.data, cached: true, tier: 'paid' }) }] };
      }

      await PriceRegistry.getInstance().seedDefaults();
      const price = await PriceRegistry.getInstance().getPrice('ftd_threshold_scan');
      if (!price) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable' }) }], isError: true };
      }

      let payment;
      try {
        payment = await executeX402Payment({ price, currency: 'USDC', toolName: 'ftd_threshold_scan', walletAddress: args.wallet_address });
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }

      const client = FtdClient.getInstance();
      const data = await client.getFullScan({ ticker: args.ticker, scanType: args.scan_type, minSpikeMultiplier: args.min_spike_multiplier });
      fullCache.set(cacheKey, { data, ts: now });

      audit.info('ftd_paid_success', { ticker: args.ticker ?? 'all', receiptId: payment.receiptId });
      return { content: [{ type: 'text', text: JSON.stringify({ data, tier: 'paid', _meta: { receipt_id: payment.receiptId, tx_hash: payment.txHash, chain: payment.chain, amount_paid: `${payment.amountPaid} ${payment.currency}` } }) }] };
    },
  );
}
