import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { PriceRegistry } from '../registry/pricing.js';
import { ShadowDeskAPI } from '../../lib/sml-api/shadow.js';

const QuerySchema = z.object({
  query: z.string().min(1).max(2048),
  context: z.string().max(1024).optional(),
  wallet_address: z.string().optional(),
});

const IngestSchema = z.object({
  source: z.string().min(1).max(256),
  payload: z.record(z.unknown()),
  wallet_address: z.string().optional(),
});

export function registerShadow(server: McpServer): void {
  const audit = AuditLogger.getInstance();

  // ── PAID: shadow_query (0.02 USDC) ────────────────────────────────────────
  server.tool(
    'shadow_query',
    {
      query: { type: 'string', description: 'Natural language query for signal intelligence (max 2048 chars).' },
      context: { type: 'string', description: 'Optional context to refine the query (max 1024 chars).' },
      wallet_address: { type: 'string', description: 'Agent wallet for x402 payment.' },
    },
    async (rawArgs) => {
      const args = Sandbox.validate(QuerySchema, rawArgs);

      if (!RateLimiter.getInstance().checkTool('shadow_query')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }

      await PriceRegistry.getInstance().seedDefaults();
      const price = await PriceRegistry.getInstance().getPrice('shadow_query');
      if (!price) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable' }) }], isError: true };
      }

      let payment;
      try {
        payment = await executeX402Payment({ price, currency: 'USDC', toolName: 'shadow_query', walletAddress: args.wallet_address });
      } catch (err) {
        audit.warn('shadow_query_payment_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }

      try {
        const data = await ShadowDeskAPI.query({
          query: args.query,
          context: args.context,
          walletAddress: args.wallet_address ?? payment.walletAddress ?? 'anonymous',
        });
        audit.info('shadow_query_success', { receiptId: payment.receiptId });
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
        audit.error('shadow_query_api_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );

  // ── PAID: shadow_ingest (0.01 USDC) ───────────────────────────────────────
  server.tool(
    'shadow_ingest',
    {
      source: { type: 'string', description: 'Source identifier for the data being ingested (e.g. "discord", "twitter", "on-chain").' },
      payload: { type: 'object', description: 'Signal data payload as a JSON object.' },
      wallet_address: { type: 'string', description: 'Agent wallet for x402 payment.' },
    },
    async (rawArgs) => {
      const args = Sandbox.validate(IngestSchema, rawArgs);

      if (!RateLimiter.getInstance().checkTool('shadow_ingest')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }

      await PriceRegistry.getInstance().seedDefaults();
      const price = await PriceRegistry.getInstance().getPrice('shadow_ingest');
      if (!price) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable' }) }], isError: true };
      }

      let payment;
      try {
        payment = await executeX402Payment({ price, currency: 'USDC', toolName: 'shadow_ingest', walletAddress: args.wallet_address });
      } catch (err) {
        audit.warn('shadow_ingest_payment_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }

      try {
        const data = await ShadowDeskAPI.ingest({
          source: args.source,
          payload: args.payload,
          walletAddress: args.wallet_address ?? payment.walletAddress ?? 'anonymous',
        });
        audit.info('shadow_ingest_success', { source: args.source, receiptId: payment.receiptId });
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
        audit.error('shadow_ingest_api_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );
}
