import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { XdeoClient } from '../../lib/sml-api/xdeo.js';
import { CreditBureau } from '../../lib/credit/bureau.js';
import { WalletManager } from '../payments/wallet.js';
import { PriceRegistry } from '../registry/pricing.js';

const InputSchema = z.object({
  ticker: z.string().regex(/^[A-Z]{1,5}$/),
  fiscal_quarter: z.string().regex(/^Q[1-4]\d{4}$/),
  estimate_type: z.enum(['eps', 'revenue', 'guidance', 'all']),
  wallet_address: z.string().optional(),
});

export function registerXdeo(server: McpServer): void {
  server.tool(
    'xdeo_earnings_estimate',
    {
      ticker: { type: 'string', description: 'Ticker symbol (e.g. NVDA).' },
      fiscal_quarter: { type: 'string', description: 'Quarter in format Q1YYYY (e.g. Q12025).' },
      estimate_type: { type: 'string', enum: ['eps', 'revenue', 'guidance', 'all'], description: 'What estimate to fetch.' },
      wallet_address: { type: 'string', description: 'Agent wallet for payment.' },
    },
    async (rawArgs) => {
      const args = Sandbox.validate(InputSchema, rawArgs);
      const audit = AuditLogger.getInstance();

      if (!RateLimiter.getInstance().checkTool('xdeo_earnings_estimate')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded' }) }], isError: true };
      }

      await PriceRegistry.getInstance().seedDefaults();
      const price = await PriceRegistry.getInstance().getPrice('xdeo_earnings_estimate');
      if (!price) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable' }) }], isError: true };
      }

      let payment;
      try {
        payment = await executeX402Payment({ price, currency: 'USDC', toolName: 'xdeo_earnings_estimate', walletAddress: args.wallet_address });
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }

      const client = XdeoClient.getInstance();
      const data = await client.getEstimate({
        ticker: args.ticker,
        fiscalQuarter: args.fiscal_quarter,
        estimateType: args.estimate_type,
      });

      // +2 bureau_score on success (spec requirement)
      const wallet = await WalletManager.getInstance().getOrCreateWallet();
      await CreditBureau.getInstance().incrementScore(wallet.address, 2);

      audit.info('xdeo_success', { ticker: args.ticker, quarter: args.fiscal_quarter, receiptId: payment.receiptId });

      return {
        content: [{ type: 'text', text: JSON.stringify({ data, bureau_score_delta: '+2', _meta: { receipt_id: payment.receiptId, tx_hash: payment.txHash, chain: payment.chain, amount_paid: `${payment.amountPaid} ${payment.currency}` } }) }],
      };
    },
  );
}
