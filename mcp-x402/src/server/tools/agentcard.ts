import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { PriceRegistry } from '../registry/pricing.js';
import { AgentCardAPI } from '../../lib/sml-api/agentcard.js';

const LookupSchema = z.object({
  identifier: z.string().min(1),
});

const VerifySchema = z.object({
  wallet_address: z.string().min(10),
  message: z.string().min(1),
  signature: z.string().min(1),
});

const MintSchema = z.object({
  wallet_address: z.string().min(10),
  name: z.string().min(1).max(64),
  did: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  payment_wallet: z.string().optional(),
});

export function registerAgentCard(server: McpServer): void {
  const audit = AuditLogger.getInstance();

  // ── FREE: agentcard_lookup ─────────────────────────────────────────────────
  server.tool(
    'agentcard_lookup',
    {
      identifier: z.string().describe('Agent wallet address or DID to look up.'),
    },
    async (rawArgs) => {
      const { identifier } = Sandbox.validate(LookupSchema, rawArgs);
      if (!RateLimiter.getInstance().checkTool('agentcard_lookup')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      try {
        const data = await AgentCardAPI.lookup(identifier);
        audit.info('agentcard_lookup', { identifier });
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );

  // ── FREE: agentcard_verify ─────────────────────────────────────────────────
  server.tool(
    'agentcard_verify',
    {
      wallet_address: z.string().describe('Agent wallet address that signed the message.'),
      message: z.string().describe('Original message that was signed.'),
      signature: z.string().describe('Ed25519 signature (hex or base64).'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(VerifySchema, rawArgs);
      if (!RateLimiter.getInstance().checkTool('agentcard_verify')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      try {
        const data = await AgentCardAPI.verify({
          walletAddress: args.wallet_address,
          message: args.message,
          signature: args.signature,
        });
        audit.info('agentcard_verify', { wallet_address: args.wallet_address });
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );

  // ── PAID: agentcard_mint (0.01 USDC) ──────────────────────────────────────
  server.tool(
    'agentcard_mint',
    {
      wallet_address: z.string().describe('XRPL wallet address for the new agent identity.'),
      name: z.string().describe('Human-readable agent name (max 64 chars).'),
      did: z.string().describe('Optional DID (decentralized identifier) for the agent.'),
      metadata: z.record(z.unknown()).describe('Optional metadata object (capabilities, version, etc.).'),
      payment_wallet: z.string().describe('Wallet to pay x402 fee from (defaults to wallet_address).'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(MintSchema, rawArgs);
      const paymentWallet = args.payment_wallet ?? args.wallet_address;

      if (!RateLimiter.getInstance().checkTool('agentcard_mint')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }

      await PriceRegistry.getInstance().seedDefaults();
      const price = await PriceRegistry.getInstance().getPrice('agentcard_mint');
      if (!price) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable' }) }], isError: true };
      }

      let payment;
      try {
        payment = await executeX402Payment({ price, currency: 'USDC', toolName: 'agentcard_mint', walletAddress: paymentWallet });
      } catch (err) {
        audit.warn('agentcard_mint_payment_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }

      try {
        const data = await AgentCardAPI.mint({
          walletAddress: args.wallet_address,
          name: args.name,
          did: args.did,
          metadata: args.metadata,
        });
        audit.info('agentcard_mint_success', { name: args.name, receiptId: payment.receiptId });
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
        audit.error('agentcard_mint_api_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );
}
