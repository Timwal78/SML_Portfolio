import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { PriceRegistry } from '../registry/pricing.js';
import { EquitiesHeatmapAPI, OptionsDeltaHeatmapAPI, type DataCredentials } from '../../lib/sml-api/equities-heatmap.js';
import { notifyHeatmapSale, type HeatmapToolName } from '../../lib/notify/discord.js';
import type { HeatmapResult } from '../../lib/quant/heatmap.js';

// ── Schemas ──────────────────────────────────────────────────────────────────
// BYOK: callers may supply their own market-data credentials, which always
// take priority over this server's own env-configured keys — the operator
// never pays another caller's Tradier/Polygon/Alpaca bill. Never sent to
// Anthropic or logged; used only to fetch that caller's own market data.

const ByokFields = {
  tradier_api_key: z.string().describe('Your own Tradier API key (BYOK) — takes priority over the server default.').optional(),
  polygon_api_key: z.string().describe('Your own Polygon.io API key (BYOK) — takes priority over the server default.').optional(),
  alpaca_api_key: z.string().describe('Your own Alpaca API key ID (BYOK) — takes priority over the server default.').optional(),
  alpaca_api_secret: z.string().describe('Your own Alpaca API secret (BYOK), paired with alpaca_api_key.').optional(),
};

const OptionsPreviewSchema = z.object({
  underlying: z.string().min(1).max(10).toUpperCase().optional(),
  ...ByokFields,
});

const EquitiesHeatmapFullSchema = z.object({
  tickers: z.array(z.string().min(1).max(10)).max(20).optional(),
  timeframe: z.enum(['1h', '1d']).optional(),
  wallet_address: z.string().optional(),
  payment_tx_hash: z.string().optional(),
  payment_header: z.string().optional(),
  ...ByokFields,
});

const OptionsDeltaHeatmapFullSchema = z.object({
  underlying: z.string().min(1).max(10).optional(),
  expiration_date: z.string().optional(),
  option_type: z.enum(['call', 'put']).optional(),
  wallet_address: z.string().optional(),
  payment_tx_hash: z.string().optional(),
  payment_header: z.string().optional(),
  ...ByokFields,
});

function extractCredentials(args: {
  tradier_api_key?: string;
  polygon_api_key?: string;
  alpaca_api_key?: string;
  alpaca_api_secret?: string;
}): DataCredentials {
  return {
    tradierApiKey: args.tradier_api_key,
    polygonApiKey: args.polygon_api_key,
    alpacaApiKey: args.alpaca_api_key,
    alpacaApiSecret: args.alpaca_api_secret,
  };
}

// ── Helper ────────────────────────────────────────────────────────────────────

async function paidCall(
  toolName: string,
  walletAddress: string | undefined,
  paymentTxHash: string | undefined,
  paymentHeader: string | undefined,
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
    payment = await executeX402Payment({ price, currency: 'USDC', toolName, walletAddress, paymentTxHash, paymentHeader });
  } catch (err) {
    audit.warn(`${toolName}_payment_fail`, { error: String(err) });
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
  }

  try {
    const data = await fn();
    audit.info(`${toolName}_success`, { receiptId: payment.receiptId });

    // Best-effort Discord sale alert — fire-and-forget, never awaited, never
    // allowed to affect the tool response. Both heatmap tools return a
    // { heatmap, swarm: { synthesis } } shape; feature-detect rather than
    // trusting the (untyped) toolName string.
    const typedData = data as { heatmap?: HeatmapResult; swarm?: { synthesis?: string } };
    if (typedData.heatmap && typedData.swarm?.synthesis) {
      notifyHeatmapSale({
        toolName: toolName as HeatmapToolName,
        amountPaid: payment.amountPaid,
        currency: payment.currency,
        walletAddress: payment.walletAddress,
        heatmap: typedData.heatmap,
        synthesis: typedData.swarm.synthesis,
      });
    }

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
    { ...ByokFields },
    async (rawArgs) => {
      if (!RateLimiter.getInstance().checkTool('equities_heatmap_preview')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      try {
        const data = await EquitiesHeatmapAPI.preview(extractCredentials(rawArgs));
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
      tickers: z.array(z.string()).describe('Up to 20 ticker symbols. Defaults to AMC/GME/IWM plus real dynamically-discovered top movers (day gainers/losers) filling the rest.').optional(),
      timeframe: z.enum(['1h', '1d']).describe('Bar timeframe for RSI computation. Defaults to 1h.').optional(),
      wallet_address: z.string().describe('Agent wallet address for x402 payment.').optional(),
      payment_tx_hash: z.string().describe('On-chain Base tx hash proving USDC payment to the operator (sovereign rail). Omit if using payment_header.').optional(),
      payment_header: z.string().describe('Base64 X-PAYMENT EIP-3009 payload, facilitator-settled (standard rail). Omit if using payment_tx_hash.').optional(),
      ...ByokFields,
    },
    async (rawArgs) => {
      const args = Sandbox.validate(EquitiesHeatmapFullSchema, rawArgs);
      return paidCall('equities_heatmap_full', args.wallet_address, args.payment_tx_hash, args.payment_header, () =>
        EquitiesHeatmapAPI.full(args.tickers, args.timeframe, extractCredentials(args)),
      );
    },
  );

  // ── FREE: options_delta_heatmap_preview ───────────────────────────────────
  server.tool(
    'options_delta_heatmap_preview',
    {
      underlying: z.string().describe('Underlying ticker symbol. Defaults to AMC.').optional(),
      ...ByokFields,
    },
    async (rawArgs) => {
      const args = Sandbox.validate(OptionsPreviewSchema, rawArgs);
      if (!RateLimiter.getInstance().checkTool('options_delta_heatmap_preview')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      try {
        const data = await OptionsDeltaHeatmapAPI.preview(args.underlying, extractCredentials(args));
        audit.info('options_delta_heatmap_preview', { underlying: args.underlying ?? 'AMC' });
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
      underlying: z.string().describe('Underlying ticker symbol. Defaults to AMC.').optional(),
      expiration_date: z.string().describe('Options expiration date (YYYY-MM-DD). Defaults to nearest available.').optional(),
      option_type: z.enum(['call', 'put']).describe('Defaults to call.').optional(),
      wallet_address: z.string().describe('Agent wallet address for x402 payment.').optional(),
      payment_tx_hash: z.string().describe('On-chain Base tx hash proving USDC payment to the operator (sovereign rail). Omit if using payment_header.').optional(),
      payment_header: z.string().describe('Base64 X-PAYMENT EIP-3009 payload, facilitator-settled (standard rail). Omit if using payment_tx_hash.').optional(),
      ...ByokFields,
    },
    async (rawArgs) => {
      const args = Sandbox.validate(OptionsDeltaHeatmapFullSchema, rawArgs);
      return paidCall('options_delta_heatmap_full', args.wallet_address, args.payment_tx_hash, args.payment_header, () =>
        OptionsDeltaHeatmapAPI.full(args.underlying, args.expiration_date, args.option_type, extractCredentials(args)),
      );
    },
  );
}
