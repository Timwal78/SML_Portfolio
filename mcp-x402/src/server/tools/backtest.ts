import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { PriceRegistry } from '../registry/pricing.js';
import { BacktestAPI } from '../../lib/sml-api/backtest.js';

const BacktestSchema = z.object({
  ticker: z.string().min(1).max(10).toUpperCase(),
  lookback_days: z.number().int().min(30).max(1260).default(252),
  fees: z.number().min(0).max(0.05).default(0.001),
  slippage: z.number().min(0).max(0.05).default(0.0005),
  momentum_window: z.number().int().min(2).max(50).default(10),
  momentum_threshold: z.number().min(0).max(0.1).default(0.001),
  wallet_address: z.string().optional(),
});

const ValidateSchema = z.object({
  ticker: z.string().min(1).max(10).toUpperCase(),
  lookback_days: z.number().int().min(60).max(1260).default(504),
  train_ratio: z.number().min(0.5).max(0.9).default(0.7),
  fees: z.number().min(0).max(0.05).default(0.001),
  slippage: z.number().min(0).max(0.05).default(0.0005),
  wallet_address: z.string().optional(),
});

export function registerBacktest(server: McpServer): void {
  const audit = AuditLogger.getInstance();

  // ── backtest_run — full backtest on live price data (FREE) ─────────────────
  server.tool(
    'backtest_run',
    {
      ticker: z.string().describe('Ticker symbol (e.g. NVDA, SPY, GME)'),
      lookback_days: z.number().describe('Days of history to backtest (30–1260, default 252)'),
      fees: z.number().describe('Round-trip commission rate (default 0.001 = 0.1%)'),
      slippage: z.number().describe('Slippage per side (default 0.0005)'),
      momentum_window: z.number().describe('Momentum rolling window in days (default 10)'),
      momentum_threshold: z.number().describe('Minimum momentum to enter long (default 0.001)'),
      wallet_address: z.string().describe('Agent wallet address (optional)'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(BacktestSchema, rawArgs);
      if (!RateLimiter.getInstance().checkTool('backtest_run')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded' }) }], isError: true };
      }
      try {
        const result = await BacktestAPI.backtest({
          ticker: args.ticker,
          lookback_days: args.lookback_days,
          fees: args.fees,
          slippage: args.slippage,
          momentum_window: args.momentum_window,
          momentum_threshold: args.momentum_threshold,
        });
        audit.info('backtest_run_success', { ticker: args.ticker });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        audit.warn('backtest_run_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  );

  // ── backtest_validate — walk-forward OOS validation ($0.02) ───────────────
  server.tool(
    'backtest_validate',
    {
      ticker: z.string().describe('Ticker symbol to validate'),
      lookback_days: z.number().describe('Total history window (60–1260, default 504 = 2 years)'),
      train_ratio: z.number().describe('Train/test split ratio (default 0.7 = 70% in-sample)'),
      fees: z.number().describe('Round-trip commission rate (default 0.001)'),
      slippage: z.number().describe('Slippage per side (default 0.0005)'),
      wallet_address: z.string().describe('Agent wallet for x402 payment (AP2 required)'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(ValidateSchema, rawArgs);
      if (!RateLimiter.getInstance().checkTool('backtest_validate')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded' }) }], isError: true };
      }
      await PriceRegistry.getInstance().seedDefaults();
      const price = await PriceRegistry.getInstance().getPrice('backtest_validate');
      if (!price) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable' }) }], isError: true };
      }
      let payment;
      try {
        payment = await executeX402Payment({ price, currency: 'USDC', toolName: 'backtest_validate', walletAddress: args.wallet_address });
      } catch (err) {
        audit.warn('backtest_validate_payment_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }
      try {
        const result = await BacktestAPI.walkForward({
          ticker: args.ticker,
          lookback_days: args.lookback_days,
          train_ratio: args.train_ratio,
          fees: args.fees,
          slippage: args.slippage,
        });
        audit.info('backtest_validate_success', { ticker: args.ticker });
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
        audit.warn('backtest_validate_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  );
}
