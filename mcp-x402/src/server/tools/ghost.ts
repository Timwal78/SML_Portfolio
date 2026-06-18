import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { PriceRegistry } from '../registry/pricing.js';
import { GhostLayerAPI } from '../../lib/sml-api/ghost.js';

const RouteSchema = z.object({
  from_chain: z.enum(['xrpl', 'base']),
  to_chain: z.enum(['xrpl', 'base']),
  amount: z.string().min(1),
  currency: z.string().min(1).max(10),
  destination_address: z.string().min(10),
  wallet_address: z.string().optional(),
});

export function registerGhost(server: McpServer): void {
  const audit = AuditLogger.getInstance();

  // ── FREE: ghost_status ────────────────────────────────────────────────────
  server.tool(
    'ghost_status',
    {},
    async () => {
      try {
        const data = await GhostLayerAPI.status();
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );

  // ── PAID: ghost_route (0.01 USDC) ─────────────────────────────────────────
  server.tool(
    'ghost_route',
    {
      from_chain: z.enum(['xrpl', 'base']).describe('Source chain.'),
      to_chain: z.enum(['xrpl', 'base']).describe('Destination chain.'),
      amount: z.string().describe('Amount to route (as string to preserve precision).'),
      currency: z.string().describe('Token/currency symbol (e.g. RLUSD, XRP, ETH).'),
      destination_address: z.string().describe('Recipient address on the destination chain.'),
      wallet_address: z.string().describe('Agent wallet for x402 payment.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(RouteSchema, rawArgs);

      if (!RateLimiter.getInstance().checkTool('ghost_route')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }

      await PriceRegistry.getInstance().seedDefaults();
      const price = await PriceRegistry.getInstance().getPrice('ghost_route');
      if (!price) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable' }) }], isError: true };
      }

      let payment;
      try {
        payment = await executeX402Payment({ price, currency: 'USDC', toolName: 'ghost_route', walletAddress: args.wallet_address });
      } catch (err) {
        audit.warn('ghost_route_payment_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }

      try {
        const data = await GhostLayerAPI.route({
          fromChain: args.from_chain,
          toChain: args.to_chain,
          amount: args.amount,
          currency: args.currency,
          destinationAddress: args.destination_address,
          walletAddress: args.wallet_address ?? payment.walletAddress ?? 'anonymous',
        });
        audit.info('ghost_route_success', { receiptId: payment.receiptId });
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
        audit.error('ghost_route_api_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );
}
