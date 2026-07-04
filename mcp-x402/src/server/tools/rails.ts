import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { PriceRegistry } from '../registry/pricing.js';
import { RailsAPI } from '../../lib/sml-api/rails.js';

const TransferSchema = z.object({
  from_address: z.string().min(10),
  to_address: z.string().min(10),
  amount: z.string().min(1),
  currency: z.enum(['RLUSD', 'XRP']),
  memo: z.string().max(256).optional(),
  wallet_address: z.string().optional(),
  payment_tx_hash: z.string().optional(),
  payment_header: z.string().optional(),
});

export function registerRails(server: McpServer): void {
  const audit = AuditLogger.getInstance();

  // ── FREE: rails_status ────────────────────────────────────────────────────
  server.tool(
    'rails_status',
    {},
    async () => {
      try {
        const data = await RailsAPI.status();
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );

  // ── PAID: rails_transfer (0.01 USDC) ──────────────────────────────────────
  server.tool(
    'rails_transfer',
    {
      from_address: z.string().describe('Sender XRPL address.'),
      to_address: z.string().describe('Recipient XRPL or Xahau address.'),
      amount: z.string().describe('Amount to transfer (as string to preserve precision).'),
      currency: z.enum(['RLUSD', 'XRP']).describe('Token to transfer.'),
      memo: z.string().describe('Optional transfer memo (max 256 chars).'),
      wallet_address: z.string().describe('Agent wallet for x402 payment.'),
      payment_tx_hash: z.string().optional().describe('On-chain Base tx hash proving USDC payment to the operator (sovereign rail). Omit if using payment_header.'),
      payment_header: z.string().optional().describe('Base64 X-PAYMENT EIP-3009 payload, facilitator-settled (standard rail). Omit if using payment_tx_hash.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(TransferSchema, rawArgs);

      if (!RateLimiter.getInstance().checkTool('rails_transfer')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }

      await PriceRegistry.getInstance().seedDefaults();
      const price = await PriceRegistry.getInstance().getPrice('rails_transfer');
      if (!price) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable' }) }], isError: true };
      }

      let payment;
      try {
        payment = await executeX402Payment({ price, currency: 'USDC', toolName: 'rails_transfer', walletAddress: args.wallet_address, paymentTxHash: args.payment_tx_hash, paymentHeader: args.payment_header });
      } catch (err) {
        audit.warn('rails_transfer_payment_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }

      try {
        const data = await RailsAPI.transfer({
          fromAddress: args.from_address,
          toAddress: args.to_address,
          amount: args.amount,
          currency: args.currency,
          memo: args.memo,
        });
        audit.info('rails_transfer_success', { receiptId: payment.receiptId });
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
        audit.error('rails_transfer_api_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );
}
