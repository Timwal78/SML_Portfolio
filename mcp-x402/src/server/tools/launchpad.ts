import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { PriceRegistry } from '../registry/pricing.js';
import { LaunchpadAPI } from '../../lib/sml-api/launchpad.js';

const CreateSchema = z.object({
  name: z.string().min(1).max(64),
  symbol: z.string().min(1).max(10).toUpperCase(),
  description: z.string().max(512),
  creator_address: z.string().min(10),
  initial_supply: z.number().int().positive(),
  target_liquidity_xrp: z.number().positive(),
  wallet_address: z.string().optional(),
  payment_tx_hash: z.string().optional(),
  payment_header: z.string().optional(),
});

const BuySchema = z.object({
  token_address: z.string().min(10),
  buyer_address: z.string().min(10),
  xrp_amount: z.number().positive(),
  wallet_address: z.string().optional(),
  payment_tx_hash: z.string().optional(),
  payment_header: z.string().optional(),
});

export function registerLaunchpad(server: McpServer): void {
  const audit = AuditLogger.getInstance();

  // ── FREE: launchpad_status ─────────────────────────────────────────────────
  server.tool(
    'launchpad_status',
    {},
    async () => {
      try {
        const data = await LaunchpadAPI.status();
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );

  // ── FREE: launchpad_list ───────────────────────────────────────────────────
  server.tool(
    'launchpad_list',
    {},
    async () => {
      if (!RateLimiter.getInstance().checkTool('launchpad_list')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      try {
        const data = await LaunchpadAPI.list();
        audit.info('launchpad_list', {});
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );

  // ── PAID: launchpad_create (0.10 USDC) ────────────────────────────────────
  server.tool(
    'launchpad_create',
    {
      name: z.string().describe('Token name (e.g. "Moon Rocket").'),
      symbol: z.string().describe('Ticker symbol (e.g. MNRKT, max 10 chars).'),
      description: z.string().describe('Token description (max 512 chars).'),
      creator_address: z.string().describe('XRPL address of the token creator.'),
      initial_supply: z.number().describe('Total token supply (integer).'),
      target_liquidity_xrp: z.number().describe('XRP target to graduate from bonding curve to DEX.'),
      wallet_address: z.string().describe('Agent wallet for x402 payment.'),
      payment_tx_hash: z.string().optional().describe('On-chain Base tx hash proving USDC payment to the operator (sovereign rail). Omit if using payment_header.'),
      payment_header: z.string().optional().describe('Base64 X-PAYMENT EIP-3009 payload, facilitator-settled (standard rail). Omit if using payment_tx_hash.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(CreateSchema, rawArgs);

      if (!RateLimiter.getInstance().checkTool('launchpad_create')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }

      await PriceRegistry.getInstance().seedDefaults();
      const price = await PriceRegistry.getInstance().getPrice('launchpad_create');
      if (!price) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable' }) }], isError: true };
      }

      let payment;
      try {
        payment = await executeX402Payment({ price, currency: 'USDC', toolName: 'launchpad_create', walletAddress: args.wallet_address, paymentTxHash: args.payment_tx_hash, paymentHeader: args.payment_header });
      } catch (err) {
        audit.warn('launchpad_create_payment_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }

      try {
        const data = await LaunchpadAPI.create({
          name: args.name,
          symbol: args.symbol,
          description: args.description,
          creatorAddress: args.creator_address,
          initialSupply: args.initial_supply,
          targetLiquidityXrp: args.target_liquidity_xrp,
        });
        audit.info('launchpad_create_success', { symbol: args.symbol, receiptId: payment.receiptId });
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
        audit.error('launchpad_create_api_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );

  // ── PAID: launchpad_buy (0.01 USDC) ───────────────────────────────────────
  server.tool(
    'launchpad_buy',
    {
      token_address: z.string().describe('Token contract/address on XRPL.'),
      buyer_address: z.string().describe('XRPL address of the buyer.'),
      xrp_amount: z.number().describe('Amount of XRP to spend on the bonding curve.'),
      wallet_address: z.string().describe('Agent wallet for x402 payment.'),
      payment_tx_hash: z.string().optional().describe('On-chain Base tx hash proving USDC payment to the operator (sovereign rail). Omit if using payment_header.'),
      payment_header: z.string().optional().describe('Base64 X-PAYMENT EIP-3009 payload, facilitator-settled (standard rail). Omit if using payment_tx_hash.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(BuySchema, rawArgs);

      if (!RateLimiter.getInstance().checkTool('launchpad_buy')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }

      await PriceRegistry.getInstance().seedDefaults();
      const price = await PriceRegistry.getInstance().getPrice('launchpad_buy');
      if (!price) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable' }) }], isError: true };
      }

      let payment;
      try {
        payment = await executeX402Payment({ price, currency: 'USDC', toolName: 'launchpad_buy', walletAddress: args.wallet_address, paymentTxHash: args.payment_tx_hash, paymentHeader: args.payment_header });
      } catch (err) {
        audit.warn('launchpad_buy_payment_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }

      try {
        const data = await LaunchpadAPI.buy({
          tokenAddress: args.token_address,
          buyerAddress: args.buyer_address,
          xrpAmount: args.xrp_amount,
        });
        audit.info('launchpad_buy_success', { receiptId: payment.receiptId });
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
        audit.error('launchpad_buy_api_fail', { error: String(err) });
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'api_error', message: String(err) }) }], isError: true };
      }
    },
  );
}
