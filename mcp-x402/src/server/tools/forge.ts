import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { PriceRegistry } from '../registry/pricing.js';
import { ForgeGatewayAPI } from '../../lib/sml-api/forge.js';

const LLMSchema = z.object({
  model: z.string().min(1).max(64),
  prompt: z.string().min(1).max(32768),
  max_tokens: z.number().int().positive().max(8192).optional(),
  wallet_address: z.string().optional(),
});

export function registerForge(server: McpServer): void {
  const audit = AuditLogger.getInstance();

  // ── FREE: forge_status ─────────────────────────────────────────────────────
  server.tool(
    'forge_status',
    {},
    async () => {
      try {
        const data = await ForgeGatewayAPI.status();
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );

  // ── PAID: forge_llm (0.02 USDC) ───────────────────────────────────────────
  server.tool(
    'forge_llm',
    {
      model: { type: 'string', description: 'Model identifier (e.g. "claude-3-5-haiku-20241022", "gpt-4o-mini").' },
      prompt: { type: 'string', description: 'Prompt to send to the LLM (max 32768 chars).' },
      max_tokens: { type: 'number', description: 'Maximum tokens in the response (default: model max). Max: 8192.' },
      wallet_address: { type: 'string', description: 'Agent wallet for x402 pay-per-token billing.' },
    },
    async (rawArgs) => {
      const args = Sandbox.validate(LLMSchema, rawArgs);

      if (!RateLimiter.getInstance().checkTool('forge_llm')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }

      await PriceRegistry.getInstance().seedDefaults();
      const price = await PriceRegistry.getInstance().getPrice('forge_llm');
      if (!price) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable' }) }], isError: true };
      }

      let payment;
      try {
        payment = await executeX402Payment({ price, currency: 'USDC', toolName: 'forge_llm', walletAddress: args.wallet_address });
      } catch (err) {
        audit.warn('forge_llm_payment_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }

      try {
        const data = await ForgeGatewayAPI.llm({
          model: args.model,
          prompt: args.prompt,
          maxTokens: args.max_tokens,
          walletAddress: args.wallet_address ?? payment.walletAddress ?? 'anonymous',
        });
        audit.info('forge_llm_success', { model: args.model, receiptId: payment.receiptId });
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
        audit.error('forge_llm_api_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );
}
