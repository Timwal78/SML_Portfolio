import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { PriceRegistry } from '../registry/pricing.js';
import { TradierAPI, RobinhoodAPI } from '../../lib/sml-api/brokers.js';

// ── Schemas ────────────────────────────────────────────────────────────────

const TradierQuoteSchema = z.object({
  symbols: z.string().min(1).max(200),
});

const TradierOrderSchema = z.object({
  account_id: z.string().min(1),
  symbol: z.string().min(1).max(10).toUpperCase(),
  side: z.enum(['buy', 'sell']),
  quantity: z.number().int().min(1).max(10000),
  type: z.enum(['market', 'limit', 'stop', 'stop_limit']),
  duration: z.enum(['day', 'gtc', 'pre', 'post']),
  price: z.number().positive().optional(),
  stop: z.number().positive().optional(),
  wallet_address: z.string().optional(),
  payment_tx_hash: z.string().optional(),
  payment_header: z.string().optional(),
});

const RobinhoodQuoteSchema = z.object({
  symbol: z.string().min(1).max(10).toUpperCase(),
});

const RobinhoodOrderSchema = z.object({
  symbol: z.string().min(1).max(10).toUpperCase(),
  side: z.enum(['buy', 'sell']),
  quantity: z.number().int().min(1).max(10000),
  type: z.enum(['market', 'limit']),
  time_in_force: z.enum(['gfd', 'gtc', 'ioc', 'opg']),
  price: z.number().positive().optional(),
  wallet_address: z.string().optional(),
  payment_tx_hash: z.string().optional(),
  payment_header: z.string().optional(),
});

const AccountSchema = z.object({
  account_id: z.string().min(1),
});

// ── Registration ───────────────────────────────────────────────────────────

export function registerBrokers(server: McpServer): void {
  const audit = AuditLogger.getInstance();

  // ── tradier_quote — FREE ─────────────────────────────────────────────────
  server.tool(
    'tradier_quote',
    {
      symbols: z.string().describe('Comma-separated ticker symbols (e.g. "NVDA,SPY,AAPL")'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(TradierQuoteSchema, rawArgs);
      if (!RateLimiter.getInstance().checkTool('tradier_quote')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded' }) }], isError: true };
      }
      try {
        const data = await TradierAPI.quote({ symbols: args.symbols });
        audit.info('tradier_quote_success', { symbols: args.symbols });
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        audit.warn('tradier_quote_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  );

  // ── tradier_order — $0.01 x402 ──────────────────────────────────────────
  server.tool(
    'tradier_order',
    {
      account_id: z.string().describe('Tradier brokerage account ID'),
      symbol: z.string().describe('Ticker symbol (e.g. NVDA)'),
      side: z.string().describe('"buy" or "sell"'),
      quantity: z.number().describe('Number of shares (integer)'),
      type: z.string().describe('"market" | "limit" | "stop" | "stop_limit"'),
      duration: z.string().describe('"day" | "gtc" | "pre" | "post"'),
      price: z.number().describe('Limit price (required for limit/stop_limit orders)'),
      stop: z.number().describe('Stop price (required for stop/stop_limit orders)'),
      wallet_address: z.string().describe('Agent wallet for x402 payment (AP2 required)'),
      payment_tx_hash: z.string().optional().describe('On-chain Base tx hash proving USDC payment to the operator (sovereign rail). Omit if using payment_header.'),
      payment_header: z.string().optional().describe('Base64 X-PAYMENT EIP-3009 payload, facilitator-settled (standard rail). Omit if using payment_tx_hash.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(TradierOrderSchema, rawArgs);
      if (!RateLimiter.getInstance().checkTool('tradier_order')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded' }) }], isError: true };
      }
      await PriceRegistry.getInstance().seedDefaults();
      const price = await PriceRegistry.getInstance().getPrice('tradier_order');
      if (!price) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable' }) }], isError: true };
      }
      let payment;
      try {
        payment = await executeX402Payment({ price, currency: 'USDC', toolName: 'tradier_order', walletAddress: args.wallet_address, paymentTxHash: args.payment_tx_hash, paymentHeader: args.payment_header });
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }
      try {
        const result = await TradierAPI.order({
          account_id: args.account_id,
          symbol: args.symbol,
          side: args.side,
          quantity: args.quantity,
          type: args.type,
          duration: args.duration,
          price: args.price,
          stop: args.stop,
        });
        audit.info('tradier_order_success', { symbol: args.symbol, side: args.side, quantity: args.quantity });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ...(result as object),
              _meta: { receipt_id: payment.receiptId, tx_hash: payment.txHash, chain: payment.chain, amount_paid: `${payment.amountPaid} ${payment.currency}` },
            }),
          }],
        };
      } catch (err) {
        audit.warn('tradier_order_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  );

  // ── tradier_positions — FREE ─────────────────────────────────────────────
  server.tool(
    'tradier_positions',
    {
      account_id: z.string().describe('Tradier brokerage account ID'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(AccountSchema, rawArgs);
      if (!RateLimiter.getInstance().checkTool('tradier_positions')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded' }) }], isError: true };
      }
      try {
        const [positions, balances] = await Promise.all([
          TradierAPI.positions(args.account_id),
          TradierAPI.balances(args.account_id),
        ]);
        return { content: [{ type: 'text', text: JSON.stringify({ positions, balances }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  );

  // ── robinhood_quote — FREE ───────────────────────────────────────────────
  server.tool(
    'robinhood_quote',
    {
      symbol: z.string().describe('Ticker symbol (e.g. NVDA)'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(RobinhoodQuoteSchema, rawArgs);
      if (!RateLimiter.getInstance().checkTool('robinhood_quote')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded' }) }], isError: true };
      }
      try {
        const data = await RobinhoodAPI.quote(args.symbol);
        audit.info('robinhood_quote_success', { symbol: args.symbol });
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        audit.warn('robinhood_quote_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  );

  // ── robinhood_order — $0.01 x402 ────────────────────────────────────────
  server.tool(
    'robinhood_order',
    {
      symbol: z.string().describe('Ticker symbol (e.g. NVDA)'),
      side: z.string().describe('"buy" or "sell"'),
      quantity: z.number().describe('Number of shares (integer)'),
      type: z.string().describe('"market" or "limit"'),
      time_in_force: z.string().describe('"gfd" (good for day) | "gtc" | "ioc" | "opg"'),
      price: z.number().describe('Limit price (required for limit orders)'),
      wallet_address: z.string().describe('Agent wallet for x402 payment (AP2 required)'),
      payment_tx_hash: z.string().optional().describe('On-chain Base tx hash proving USDC payment to the operator (sovereign rail). Omit if using payment_header.'),
      payment_header: z.string().optional().describe('Base64 X-PAYMENT EIP-3009 payload, facilitator-settled (standard rail). Omit if using payment_tx_hash.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(RobinhoodOrderSchema, rawArgs);
      if (!RateLimiter.getInstance().checkTool('robinhood_order')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded' }) }], isError: true };
      }
      await PriceRegistry.getInstance().seedDefaults();
      const price = await PriceRegistry.getInstance().getPrice('robinhood_order');
      if (!price) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable' }) }], isError: true };
      }
      let payment;
      try {
        payment = await executeX402Payment({ price, currency: 'USDC', toolName: 'robinhood_order', walletAddress: args.wallet_address, paymentTxHash: args.payment_tx_hash, paymentHeader: args.payment_header });
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }
      try {
        const result = await RobinhoodAPI.order({
          symbol: args.symbol,
          side: args.side,
          quantity: args.quantity,
          type: args.type,
          time_in_force: args.time_in_force,
          price: args.price,
        });
        audit.info('robinhood_order_success', { symbol: args.symbol, side: args.side, quantity: args.quantity });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ...(result as object),
              _meta: { receipt_id: payment.receiptId, tx_hash: payment.txHash, chain: payment.chain, amount_paid: `${payment.amountPaid} ${payment.currency}` },
            }),
          }],
        };
      } catch (err) {
        audit.warn('robinhood_order_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  );

  // ── robinhood_portfolio — FREE ───────────────────────────────────────────
  server.tool(
    'robinhood_portfolio',
    {},
    async () => {
      if (!RateLimiter.getInstance().checkTool('robinhood_portfolio')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded' }) }], isError: true };
      }
      try {
        const [portfolio, positions, orders] = await Promise.all([
          RobinhoodAPI.portfolio(),
          RobinhoodAPI.positions(),
          RobinhoodAPI.orderHistory(),
        ]);
        return { content: [{ type: 'text', text: JSON.stringify({ portfolio, positions, recent_orders: orders }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  );
}
