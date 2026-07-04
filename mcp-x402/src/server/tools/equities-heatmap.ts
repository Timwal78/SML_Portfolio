import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { PriceRegistry } from '../registry/pricing.js';
import { EquitiesHeatmapAPI, OptionsDeltaHeatmapAPI } from '../../lib/sml-api/equities-heatmap.js';

// ── Schemas ──────────────────────────────────────────────────────────────────

const OptionsPreviewSchema = z.object({
  underlying: z.string().min(1).max(10).toUpperCase().optional(),
});

const EquitiesHeatmapFullSchema = z.object({
  tickers: z.array(z.string().min(1).max(10)).max(20).optional(),
  timeframe: z.enum(['1h', '1d']).optional(),
  wallet_address: z.string().optional(),
});

const OptionsDeltaHeatmapFullSchema = z.object({
  underlying: z.string().min(1).max(10).optional(),
  expiration_date: z.string().optional(),
  option_type: z.enum(['call', 'put']).optional(),
  wallet_address: z.string().optional(),
});

// ── Helper ────────────────────────────────────────────────────────────────────

async function paidCall(
  toolName: string,
  walletAddress: string | undefined,
  fn: () => Promise<unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: true }> {
  const audit = AuditLogger.getInstance();

  if (!RateLimiter.getInstance().checkTool(toolName)) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
  }

  await PriceRegistry.getInstance().seedDefaults();
  const price = await PriceRegistry.getInstance().getPrice(toolName);
  if (!price) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable' }) }], isError: true };
  }

  let payment;
  try {
    payment = await executeX402Payment({ price, currency: 'USDC', toolName, walletAddress });
  } catch (err) {
    audit.warn(`${toolName}_payment_fail`, { error: String(err) });
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
  }

  try {
    const data = await fn();
    audit.info(`${toolName}_success`, { receiptId: payment.receiptId });
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          data,
          _meta: {
            receipt_id: payment.receiptId,
            tx_hash: payment.txHash,
            chain: payment.chain,
            amount_paid: `${payment.amountPaid} ${payment.currency}`,
            timestamp: payment.timestamp,
          },
        }),
      }],
    };
  } catch (err) {
    audit.error(`${toolName}_api_fail`, { error: String(err) });
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerEquitiesHeatmap(server: McpServer): void {
  const audit = AuditLogger.getInstance();

  // ── FREE: equities_heatmap_preview ────────────────────────────────────────
  server.tool(
    'equities_heatmap_preview',
    {},
    async () => {
      if (!RateLimiter.getInstance().checkTool('equities_heatmap_preview')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      try {
        const data = await EquitiesHeatmapAPI.preview();
        audit.info('equities_heatmap_preview', {});
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );

  // ── PAID: equities_heatmap_full (0.10 USDC) ───────────────────────────────
  server.tool(
    'equities_heatmap_full',
    {
      tickers: z.array(z.string()).describe('Up to 20 ticker symbols. Defaults to a 16-ticker large-cap watchlist.').optional(),
      timeframe: z.enum(['1h', '1d']).describe('Bar timeframe for RSI computation. Defaults to 1h.').optional(),
      wallet_address: z.string().describe('Agent wallet address for x402 payment.').optional(),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(EquitiesHeatmapFullSchema, rawArgs);
      return paidCall('equities_heatmap_full', args.wallet_address, () =>
        EquitiesHeatmapAPI.full(args.tickers, args.timeframe),
      );
    },
  );

  // ── FREE: options_delta_heatmap_preview ───────────────────────────────────
  server.tool(
    'options_delta_heatmap_preview',
    {
      underlying: z.string().describe('Underlying ticker symbol. Defaults to SPY.').optional(),
    },
    async (rawArgs) => {
      const { underlying } = Sandbox.validate(OptionsPreviewSchema, rawArgs);
      if (!RateLimiter.getInstance().checkTool('options_delta_heatmap_preview')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      try {
        const data = await OptionsDeltaHeatmapAPI.preview(underlying);
        audit.info('options_delta_heatmap_preview', { underlying: underlying ?? 'SPY' });
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );

  // ── PAID: options_delta_heatmap_full (0.15 USDC) ──────────────────────────
  server.tool(
    'options_delta_heatmap_full',
    {
      underlying: z.string().describe('Underlying ticker symbol. Defaults to SPY.').optional(),
      expiration_date: z.string().describe('Options expiration date (YYYY-MM-DD). Defaults to nearest available.').optional(),
      option_type: z.enum(['call', 'put']).describe('Defaults to call.').optional(),
      wallet_address: z.string().describe('Agent wallet address for x402 payment.').optional(),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(OptionsDeltaHeatmapFullSchema, rawArgs);
      return paidCall('options_delta_heatmap_full', args.wallet_address, () =>
        OptionsDeltaHeatmapAPI.full(args.underlying, args.expiration_date, args.option_type),
      );
    },
  );
}
