import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { LeviathanClient } from '../../lib/sml-api/leviathan.js';
import { PriceRegistry } from '../registry/pricing.js';

const InputSchema = z.object({
  ticker: z.string().regex(/^[A-Z]{1,5}$/).optional(),
  signal_type: z.enum(['squeeze', 'momentum', 'dark_pool', 'all']),
  min_confidence: z.number().min(0).max(100).default(60),
  wallet_address: z.string().optional(),
});

export function registerLeviathan(server: McpServer): void {
  server.tool(
    'leviathan_signal',
    {
      ticker: { type: 'string', description: 'Ticker symbol (e.g. TSLA, MSTR). Optional — omit for top signals.' },
      signal_type: { type: 'string', enum: ['squeeze', 'momentum', 'dark_pool', 'all'], description: 'Signal category.' },
      min_confidence: { type: 'number', description: 'Minimum confidence score 0-100. Default: 60.' },
      wallet_address: { type: 'string', description: 'Agent wallet address for payment. Auto-provisioned if omitted.' },
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
        });
      } catch (err) {
        audit.warn('leviathan_payment_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }

      const client = LeviathanClient.getInstance();
      const data = await client.getSignal({
        ticker: args.ticker,
        signalType: args.signal_type,
        minConfidence: args.min_confidence,
      });

      audit.info('leviathan_success', { ticker: args.ticker ?? 'all', receiptId: payment.receiptId });

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
