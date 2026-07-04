import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { PriceRegistry } from '../registry/pricing.js';
import { SqueezeOSAPI } from '../../lib/sml-api/squeezeos.js';

// ── Schemas ──────────────────────────────────────────────────────────────────

const SymbolSchema = z.object({
  symbol: z.string().min(1).max(10).toUpperCase(),
});

const OptionalSymbolSchema = z.object({
  symbol: z.string().min(1).max(10).toUpperCase().optional(),
});

const PaidSchema = z.object({
  wallet_address: z.string().optional(),
  payment_tx_hash: z.string().optional(),
  payment_header: z.string().optional(),
});

const CouncilSchema = z.object({
  symbol: z.string().min(1).max(10).toUpperCase(),
  wallet_address: z.string().optional(),
  payment_tx_hash: z.string().optional(),
  payment_header: z.string().optional(),
});

const MarketplaceReadSchema = z.object({
  listing_id: z.string().min(1),
  wallet_address: z.string().optional(),
  payment_tx_hash: z.string().optional(),
  payment_header: z.string().optional(),
});

// ── Helper ────────────────────────────────────────────────────────────────────

async function paidCall(
  toolName: string,
  walletAddress: string | undefined,
  paymentTxHash: string | undefined,
  paymentHeader: string | undefined,
  fn: (walletAddress: string) => Promise<unknown>,
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

  const effectiveWallet = walletAddress ?? payment.walletAddress ?? 'anonymous';

  try {
    const data = await fn(effectiveWallet);
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

export function registerSqueezeOS(server: McpServer): void {
  const audit = AuditLogger.getInstance();

  // ── FREE: squeezeos_preview ────────────────────────────────────────────────
  server.tool(
    'squeezeos_preview',
    {
      symbol: z.string().describe('Ticker symbol (e.g. TSLA, IWM, MSTR).'),
    },
    async (rawArgs) => {
      const { symbol } = Sandbox.validate(SymbolSchema, rawArgs);
      if (!RateLimiter.getInstance().checkTool('squeezeos_preview')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      try {
        const data = await SqueezeOSAPI.preview(symbol);
        audit.info('squeezeos_preview', { symbol });
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );

  // ── FREE: squeezeos_history ────────────────────────────────────────────────
  server.tool(
    'squeezeos_history',
    {
      symbol: z.string().describe('Ticker symbol. Omit to get all recent signals.'),
    },
    async (rawArgs) => {
      const { symbol } = Sandbox.validate(OptionalSymbolSchema, rawArgs);
      if (!RateLimiter.getInstance().checkTool('squeezeos_history')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      try {
        const data = await SqueezeOSAPI.history(symbol);
        audit.info('squeezeos_history', { symbol: symbol ?? 'all' });
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );

  // ── FREE: squeezeos_oracle ─────────────────────────────────────────────────
  server.tool(
    'squeezeos_oracle',
    {
      symbol: z.string().describe('Ticker symbol. Omit for full oracle batch.'),
    },
    async (rawArgs) => {
      const { symbol } = Sandbox.validate(OptionalSymbolSchema, rawArgs);
      if (!RateLimiter.getInstance().checkTool('squeezeos_oracle')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      try {
        const data = await SqueezeOSAPI.oracle(symbol);
        audit.info('squeezeos_oracle', { symbol: symbol ?? 'batch' });
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );

  // ── FREE: squeezeos_ftd ────────────────────────────────────────────────────
  server.tool(
    'squeezeos_ftd',
    {},
    async () => {
      if (!RateLimiter.getInstance().checkTool('squeezeos_ftd')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      try {
        const data = await SqueezeOSAPI.ftd();
        audit.info('squeezeos_ftd', {});
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );

  // ── FREE: squeezeos_status ─────────────────────────────────────────────────
  server.tool(
    'squeezeos_status',
    {},
    async () => {
      try {
        const data = await SqueezeOSAPI.status();
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );

  // ── FREE: squeezeos_demo ───────────────────────────────────────────────────
  server.tool(
    'squeezeos_demo',
    {},
    async () => {
      if (!RateLimiter.getInstance().checkTool('squeezeos_demo')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      try {
        const data = await SqueezeOSAPI.demo();
        audit.info('squeezeos_demo', {});
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );

  // ── FREE: squeezeos_marketplace_browse ────────────────────────────────────
  server.tool(
    'squeezeos_marketplace_browse',
    {},
    async () => {
      if (!RateLimiter.getInstance().checkTool('squeezeos_marketplace_browse')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      try {
        const data = await SqueezeOSAPI.marketplaceBrowse();
        audit.info('squeezeos_marketplace_browse', {});
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );

  // ── FREE: squeezeos_futures_leaderboard ───────────────────────────────────
  server.tool(
    'squeezeos_futures_leaderboard',
    {},
    async () => {
      if (!RateLimiter.getInstance().checkTool('squeezeos_futures_leaderboard')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      try {
        const data = await SqueezeOSAPI.futuresLeaderboard();
        audit.info('squeezeos_futures_leaderboard', {});
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );

  // ── PAID: squeezeos_council (0.10 USDC) ───────────────────────────────────
  server.tool(
    'squeezeos_council',
    {
      symbol: z.string().describe('Ticker symbol to analyze (e.g. TSLA, GME, IWM).'),
      wallet_address: z.string().describe('Agent wallet address for x402 payment.'),
      payment_tx_hash: z.string().optional().describe('On-chain Base tx hash proving USDC payment to the operator (sovereign rail). Omit if using payment_header.'),
      payment_header: z.string().optional().describe('Base64 X-PAYMENT EIP-3009 payload, facilitator-settled (standard rail). Omit if using payment_tx_hash.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(CouncilSchema, rawArgs);
      return paidCall('squeezeos_council', args.wallet_address, args.payment_tx_hash, args.payment_header, (wlt) =>
        SqueezeOSAPI.council(args.symbol, wlt),
      );
    },
  );

  // ── PAID: squeezeos_scan (0.05 USDC) ──────────────────────────────────────
  server.tool(
    'squeezeos_scan',
    {
      wallet_address: z.string().describe('Agent wallet address for x402 payment.'),
      payment_tx_hash: z.string().optional().describe('On-chain Base tx hash proving USDC payment to the operator (sovereign rail). Omit if using payment_header.'),
      payment_header: z.string().optional().describe('Base64 X-PAYMENT EIP-3009 payload, facilitator-settled (standard rail). Omit if using payment_tx_hash.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(PaidSchema, rawArgs);
      return paidCall('squeezeos_scan', args.wallet_address, args.payment_tx_hash, args.payment_header, (wlt) =>
        SqueezeOSAPI.scan(wlt),
      );
    },
  );

  // ── PAID: squeezeos_options (0.05 USDC) ───────────────────────────────────
  server.tool(
    'squeezeos_options',
    {
      wallet_address: z.string().describe('Agent wallet address for x402 payment.'),
      payment_tx_hash: z.string().optional().describe('On-chain Base tx hash proving USDC payment to the operator (sovereign rail). Omit if using payment_header.'),
      payment_header: z.string().optional().describe('Base64 X-PAYMENT EIP-3009 payload, facilitator-settled (standard rail). Omit if using payment_tx_hash.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(PaidSchema, rawArgs);
      return paidCall('squeezeos_options', args.wallet_address, args.payment_tx_hash, args.payment_header, (wlt) =>
        SqueezeOSAPI.options(wlt),
      );
    },
  );

  // ── PAID: squeezeos_iwm (0.03 USDC) ───────────────────────────────────────
  server.tool(
    'squeezeos_iwm',
    {
      wallet_address: z.string().describe('Agent wallet address for x402 payment.'),
      payment_tx_hash: z.string().optional().describe('On-chain Base tx hash proving USDC payment to the operator (sovereign rail). Omit if using payment_header.'),
      payment_header: z.string().optional().describe('Base64 X-PAYMENT EIP-3009 payload, facilitator-settled (standard rail). Omit if using payment_tx_hash.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(PaidSchema, rawArgs);
      return paidCall('squeezeos_iwm', args.wallet_address, args.payment_tx_hash, args.payment_header, (wlt) =>
        SqueezeOSAPI.iwm(wlt),
      );
    },
  );

  // ── PAID: squeezeos_marketplace_read (0.02 USDC) ──────────────────────────
  server.tool(
    'squeezeos_marketplace_read',
    {
      listing_id: z.string().describe('Listing ID from squeezeos_marketplace_browse.'),
      wallet_address: z.string().describe('Agent wallet address for x402 payment.'),
      payment_tx_hash: z.string().optional().describe('On-chain Base tx hash proving USDC payment to the operator (sovereign rail). Omit if using payment_header.'),
      payment_header: z.string().optional().describe('Base64 X-PAYMENT EIP-3009 payload, facilitator-settled (standard rail). Omit if using payment_tx_hash.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(MarketplaceReadSchema, rawArgs);
      return paidCall('squeezeos_marketplace_read', args.wallet_address, args.payment_tx_hash, args.payment_header, (wlt) =>
        SqueezeOSAPI.marketplaceRead(args.listing_id, wlt),
      );
    },
  );
}
