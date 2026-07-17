import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { PriceRegistry } from '../registry/pricing.js';

// Frankfurter API -- daily exchange rates from 84 central banks, 201
// currencies back to 1948. Confirmed directly against the real v2 route
// source (github.com/lineofflight/frankfurter, lib/versions/v2/rate_query.rb),
// not guessed: no API key, no quota. FX is a proven high-frequency data
// category for financial/payment agents -- pairs naturally with
// crypto_token_price for any agent doing cross-currency conversion.
const FX_URL = 'https://api.frankfurter.dev/v2/rates';

const FxSchema = z.object({
  base: z.string().length(3).default('USD'),
  quotes: z.string().max(200).optional(),
  date: z.string().optional(),
  wallet_address: z.string().optional(),
  payment_tx_hash: z.string().optional(),
  payment_header: z.string().optional(),
});

export function registerFxRates(server: McpServer): void {
  const audit = AuditLogger.getInstance();

  // ── fx_exchange_rate ── PAID (Frankfurter, real data, no key needed) ──
  server.tool(
    'fx_exchange_rate',
    {
      base: z.string().describe('3-letter base currency code, e.g. "USD". Default USD.'),
      quotes: z.string().optional().describe('Comma-separated 3-letter target currency codes to filter, e.g. "EUR,GBP,JPY". Omit for all available currencies.'),
      date: z.string().optional().describe('Historical rate date (YYYY-MM-DD). Omit for the latest available rate.'),
      wallet_address: z.string().describe('Agent wallet for x402 payment. Humans bypass automatically.'),
      payment_tx_hash: z.string().optional().describe('On-chain Base tx hash proving USDC payment to the operator (sovereign rail). Omit if using payment_header.'),
      payment_header: z.string().optional().describe('Base64 X-PAYMENT EIP-3009 payload, facilitator-settled (standard rail). Omit if using payment_tx_hash.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(FxSchema, rawArgs);
      if (!RateLimiter.getInstance().checkTool('fx_exchange_rate')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      await PriceRegistry.getInstance().seedDefaults();
      const price = await PriceRegistry.getInstance().getPrice('fx_exchange_rate');
      if (!price) return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable' }) }], isError: true };
      let payment;
      try {
        payment = await executeX402Payment({ price, currency: 'USDC', toolName: 'fx_exchange_rate', walletAddress: args.wallet_address, paymentTxHash: args.payment_tx_hash, paymentHeader: args.payment_header });
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }
      const params = new URLSearchParams({ base: (args.base ?? 'USD').toUpperCase() });
      if (args.quotes) params.set('quotes', args.quotes.toUpperCase());
      if (args.date) params.set('date', args.date);
      const meta = { receipt_id: payment.receiptId, tx_hash: payment.txHash, chain: payment.chain, amount_paid: `${payment.amountPaid} ${payment.currency}` };
      try {
        const resp = await fetch(`${FX_URL}?${params.toString()}`, { headers: { Accept: 'application/json' } });
        if (!resp.ok) {
          const body = await resp.text();
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'fx_api_error', status: resp.status, detail: Sandbox.sanitizeApiResponse(body).slice(0, 300), _meta: meta }) }], isError: true };
        }
        const json: any = await resp.json();
        audit.info('fx_exchange_rate_success', { base: args.base ?? 'USD', receiptId: payment.receiptId });
        return { content: [{ type: 'text', text: JSON.stringify({ source: 'frankfurter.dev/v2/rates', data: json, _meta: meta }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'fx_fetch_failed', message: String(err), _meta: meta }) }], isError: true };
      }
    },
  );
}
