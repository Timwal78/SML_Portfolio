import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { CrawlClient, type CrawlResult } from '../../lib/sml-api/crawl.js';
import { PriceRegistry } from '../registry/pricing.js';

const InputSchema = z.object({
  url: z.string().url(),
  extract: z.enum(['text', 'links', 'tables', 'structured', 'all']).default('text'),
  wallet_address: z.string().optional(),
  user_agent: z.string().optional(),
  payment_tx_hash: z.string().optional(),
  payment_header: z.string().optional(),
});

export function registerCrawl(server: McpServer): void {
  server.tool(
    'crawl_paid_fetch',
    {
      url: z.string().describe('URL to fetch and parse. Must be http or https.'),
      extract: z.enum(['text', 'links', 'tables', 'structured', 'all']).describe('What to extract. Default: text.'),
      wallet_address: z.string().describe('Agent wallet for payment. Humans bypass automatically.'),
      user_agent: z.string().describe('Custom user-agent string.'),
      payment_tx_hash: z.string().optional().describe('On-chain Base tx hash proving USDC payment to the operator (sovereign rail). Omit if using payment_header.'),
      payment_header: z.string().optional().describe('Base64 X-PAYMENT EIP-3009 payload, facilitator-settled (standard rail). Omit if using payment_tx_hash.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(InputSchema, rawArgs);
      const audit = AuditLogger.getInstance();

      // Validate URL safety
      Sandbox.validateUrl(args.url);

      if (!RateLimiter.getInstance().checkTool('crawl_paid_fetch')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded' }) }], isError: true };
      }

      // Fetch BEFORE charging — never bill for a call we can't fulfill.
      // CrawlClient does a real, self-contained fetch + HTML extraction
      // (SSRF-guarded) — fixed 2026-08-01, previously called a dead host
      // (api.scriptmasterlabs.com) with no real backend anywhere.
      const client = CrawlClient.getInstance();
      let data: CrawlResult;
      try {
        data = await client.fetch({ url: args.url, extract: args.extract ?? 'text', userAgent: args.user_agent });
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'upstream_unavailable', message: String(err) }) }], isError: true };
      }

      await PriceRegistry.getInstance().seedDefaults();
      const price = await PriceRegistry.getInstance().getPrice('crawl_paid_fetch');
      if (!price) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable' }) }], isError: true };
      }

      let payment;
      try {
        payment = await executeX402Payment({
          price,
          currency: 'USDC',
          toolName: 'crawl_paid_fetch',
          walletAddress: args.wallet_address,
          paymentTxHash: args.payment_tx_hash,
          paymentHeader: args.payment_header,
        });
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }

      // Sanitize response to prevent prompt injection — recurse into
      // arrays/objects too, since real page text (link labels, table cells,
      // headings, meta values) now actually flows through for every
      // extract mode, not just 'text'.
      const safeContent = Sandbox.sanitizeDeep(data.content);

      audit.info('crawl_success', { receiptId: payment.receiptId });

      return {
        content: [{ type: 'text', text: JSON.stringify({ data: { ...data, content: safeContent }, _meta: { receipt_id: payment.receiptId, tx_hash: payment.txHash, chain: payment.chain, amount_paid: `${payment.amountPaid} ${payment.currency}` } }) }],
      };
    },
  );
}
