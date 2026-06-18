import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { Proof402API } from '../../lib/sml-api/proof402.js';

const InvoiceSchema = z.object({
  endpoint_id: z.string().uuid(),
});

const VerifySchema = z.object({
  tx_hash: z.string().min(10),
  endpoint_id: z.string().uuid(),
});

const CreditSchema = z.object({
  wallet_address: z.string().min(10),
});

export function registerProof402(server: McpServer): void {
  const audit = AuditLogger.getInstance();

  // ── FREE: proof_invoice ────────────────────────────────────────────────────
  server.tool(
    'proof_invoice',
    {
      endpoint_id: z.string().describe('UUID of the premium endpoint to get a payment invoice for.'),
    },
    async (rawArgs) => {
      const { endpoint_id } = Sandbox.validate(InvoiceSchema, rawArgs);
      if (!RateLimiter.getInstance().checkTool('proof_invoice')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      try {
        const data = await Proof402API.invoice(endpoint_id);
        audit.info('proof_invoice', { endpoint_id });
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );

  // ── FREE: proof_verify ─────────────────────────────────────────────────────
  server.tool(
    'proof_verify',
    {
      tx_hash: z.string().describe('XRPL transaction hash to verify.'),
      endpoint_id: z.string().describe('UUID of the endpoint the payment was for.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(VerifySchema, rawArgs);
      if (!RateLimiter.getInstance().checkTool('proof_verify')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      try {
        const data = await Proof402API.verify(args.tx_hash, args.endpoint_id);
        audit.info('proof_verify', { tx_hash: args.tx_hash });
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );

  // ── FREE: proof_credit_score ───────────────────────────────────────────────
  server.tool(
    'proof_credit_score',
    {
      wallet_address: z.string().describe('Agent wallet address to look up credit score for (300-850 scale).'),
    },
    async (rawArgs) => {
      const { wallet_address } = Sandbox.validate(CreditSchema, rawArgs);
      if (!RateLimiter.getInstance().checkTool('proof_credit_score')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      try {
        const data = await Proof402API.creditScore(wallet_address);
        audit.info('proof_credit_score', { wallet_address });
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );
}
