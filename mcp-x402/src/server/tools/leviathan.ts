import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { LeviathanClient } from '../../lib/sml-api/leviathan.js';
import { PriceRegistry } from '../registry/pricing.js';

const InputSchema = z.object({
  ticker: z.string().regex(/^[A-Z]{1,10}$/),
  signal_type: z.enum(['squeeze', 'momentum', 'all']),
  wallet_address: z.string().optional(),
  payment_tx_hash: z.string().optional(),
  payment_header: z.string().optional(),
});

export function registerLeviathan(server: McpServer): void {
  server.tool(
    'leviathan_signal',
    {
      ticker: z.string().describe('Ticker symbol (e.g. TSLA, MSTR, SPY). Required.'),
      signal_type: z
        .enum(['squeeze', 'momentum', 'all'])
        .describe(
          'squeeze — 741-EMA stack alignment + squeeze_alert flag. ' +
          'momentum — 365-day EMA trend (ABOVE/BELOW). ' +
          'all — full multi-engine composite (741 + 365 + TripleLock).',
        ),
      wallet_address: z.string().describe('Agent wallet address for payment. Auto-provisioned if omitted.'),
      payment_tx_hash: z.string().optional().describe('On-chain Base tx hash proving USDC payment to the operator (sovereign rail). Omit if using payment_header.'),
      payment_header: z.string().optional().describe('Base64 X-PAYMENT EIP-3009 payload, facilitator-settled (standard rail). Omit if using payment_tx_hash.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(InputSchema, rawArgs);
      const audit = AuditLogger.getInstance();

      if (!RateLimiter.getInstance().checkTool('leviathan_signal')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }

      await PriceRegistry.getInstance().seedDefaults();
      const price = await PriceRegistry.getInstance().getPrice('leviathan_signal');
      if (!price) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable', message: 'Cannot determine price. Try again shortly.' }) }], isError: true };
      }

      let payment;
      try {
        payment = await executeX402Payment({
          price,
          currency: 'USDC',
          toolName: 'leviathan_signal',
          walletAddress: args.wallet_address,
          paymentTxHash: args.payment_tx_hash,
          paymentHeader: args.payment_header,
        });
      } catch (err) {
        audit.warn('leviathan_payment_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }

      const client = LeviathanClient.getInstance();
      const data = await client.getSignal({
        ticker: args.ticker,
        signalType: args.signal_type,
      });

      audit.info('leviathan_success', { ticker: args.ticker, signal_type: args.signal_type, receiptId: payment.receiptId });

      return {
        content: [
          {
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
          },
        ],
      };
    },
  );
}
