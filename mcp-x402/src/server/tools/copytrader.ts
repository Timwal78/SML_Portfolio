import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { PriceRegistry } from '../registry/pricing.js';
import { CopyTraderAPI } from '../../lib/sml-api/copytrader.js';

const SubscribeSchema = z.object({
  whale_address: z.string().min(10),
  subscriber_address: z.string().min(10),
  max_copy_amount_xrp: z.number().positive(),
  wallet_address: z.string().optional(),
});

export function registerCopyTrader(server: McpServer): void {
  const audit = AuditLogger.getInstance();

  // ── FREE: copytrader_status ────────────────────────────────────────────────
  server.tool(
    'copytrader_status',
    {},
    async () => {
      try {
        const data = await CopyTraderAPI.status();
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );

  // ── FREE: copytrader_whales ────────────────────────────────────────────────
  server.tool(
    'copytrader_whales',
    {},
    async () => {
      if (!RateLimiter.getInstance().checkTool('copytrader_whales')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      try {
        const data = await CopyTraderAPI.whales();
        audit.info('copytrader_whales', {});
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );

  // ── PAID: copytrader_subscribe (0.05 USDC) ────────────────────────────────
  server.tool(
    'copytrader_subscribe',
    {
      whale_address: { type: 'string', description: 'XRPL address of the whale to copy.' },
      subscriber_address: { type: 'string', description: 'Your XRPL address that will mirror trades.' },
      max_copy_amount_xrp: { type: 'number', description: 'Maximum XRP to allocate per copied trade.' },
      wallet_address: { type: 'string', description: 'Agent wallet for x402 payment.' },
    },
    async (rawArgs) => {
      const args = Sandbox.validate(SubscribeSchema, rawArgs);

      if (!RateLimiter.getInstance().checkTool('copytrader_subscribe')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }

      await PriceRegistry.getInstance().seedDefaults();
      const price = await PriceRegistry.getInstance().getPrice('copytrader_subscribe');
      if (!price) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable' }) }], isError: true };
      }

      let payment;
      try {
        payment = await executeX402Payment({ price, currency: 'USDC', toolName: 'copytrader_subscribe', walletAddress: args.wallet_address });
      } catch (err) {
        audit.warn('copytrader_subscribe_payment_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }

      try {
        const data = await CopyTraderAPI.subscribe({
          whaleAddress: args.whale_address,
          subscriberAddress: args.subscriber_address,
          maxCopyAmountXrp: args.max_copy_amount_xrp,
        });
        audit.info('copytrader_subscribe_success', { receiptId: payment.receiptId });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              data,
              _meta: { receipt_id: payment.receiptId, tx_hash: payment.txHash, chain: payment.chain, amount_paid: `${payment.amountPaid} ${payment.currency}`, timestamp: payment.timestamp },
            }),
          }],
        };
      } catch (err) {
        audit.error('copytrader_subscribe_api_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );
}
