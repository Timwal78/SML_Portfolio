import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { XmitClient } from '../../lib/sml-api/xmit.js';
import { PriceRegistry } from '../registry/pricing.js';

const InputSchema = z.object({
  filing_url: z.string().url(),
  parse_target: z.enum(['executive_pay', 'holdings', 'ownership_changes', 'all']),
  format: z.enum(['json', 'markdown']).default('json'),
  wallet_address: z.string().optional(),
});

export function registerXmit(server: McpServer): void {
  server.tool(
    'xmit_edgar_decode',
    {
      filing_url: { type: 'string', description: 'SEC EDGAR filing URL (DEF 14A, 13F, or 13D).' },
      parse_target: { type: 'string', enum: ['executive_pay', 'holdings', 'ownership_changes', 'all'], description: 'What to extract.' },
      format: { type: 'string', enum: ['json', 'markdown'], description: 'Output format. Default: json.' },
      wallet_address: { type: 'string', description: 'Agent wallet for payment.' },
    },
    async (rawArgs) => {
      const args = Sandbox.validate(InputSchema, rawArgs);
      const audit = AuditLogger.getInstance();

      // Validate URL is https SEC EDGAR URL
      const url = Sandbox.validateUrl(args.filing_url);
      if (!url.hostname.endsWith('sec.gov') && !url.hostname.endsWith('edgar.sec.gov')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'invalid_url', message: 'Only SEC EDGAR URLs are accepted.' }) }], isError: true };
      }

      if (!RateLimiter.getInstance().checkTool('xmit_edgar_decode')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded' }) }], isError: true };
      }

      await PriceRegistry.getInstance().seedDefaults();
      const price = await PriceRegistry.getInstance().getPrice('xmit_edgar_decode');
      if (!price) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable' }) }], isError: true };
      }

      let payment;
      try {
        payment = await executeX402Payment({ price, currency: 'USDC', toolName: 'xmit_edgar_decode', walletAddress: args.wallet_address });
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }

      const client = XmitClient.getInstance();
      const data = await client.decode({
        filingUrl: args.filing_url,
        parseTarget: args.parse_target,
        format: args.format,
      });

      // Raw text NEVER returned (N3) — only structured parsed output
      audit.info('xmit_success', { receiptId: payment.receiptId });

      return {
        content: [{ type: 'text', text: JSON.stringify({ data, _meta: { receipt_id: payment.receiptId, tx_hash: payment.txHash, chain: payment.chain, amount_paid: `${payment.amountPaid} ${payment.currency}` } }) }],
      };
    },
  );
}
