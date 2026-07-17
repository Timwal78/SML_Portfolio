import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { PriceRegistry } from '../registry/pricing.js';

// Trade.gov Trade Leads API — real overseas contract/tender opportunities for
// US exporters (foreign government tenders and private-sector RFPs sourced by
// ITA's global commercial network). Same data.trade.gov family and same
// no-API-key pattern as the Consolidated Screening List — confirmed directly
// against the developer.trade.gov docs, not guessed.
const TRADE_LEADS_URL = 'https://data.trade.gov/trade_leads/v1/search';

const TradeLeadsSchema = z.object({
  q: z.string().max(200).optional(),
  country_codes: z.string().max(200).optional(),
  tender_start_from: z.string().optional(),
  tender_start_to: z.string().optional(),
  contract_start_from: z.string().optional(),
  contract_start_to: z.string().optional(),
  size: z.number().int().min(1).max(50).default(20),
  wallet_address: z.string().optional(),
  payment_tx_hash: z.string().optional(),
  payment_header: z.string().optional(),
});

export function registerTradeLeads(server: McpServer): void {
  const audit = AuditLogger.getInstance();

  // ── search_trade_leads ── PAID (Trade.gov Trade Leads, real data, no key needed) ──
  server.tool(
    'search_trade_leads',
    {
      q: z.string().optional().describe('Keyword search across trade lead titles/descriptions, e.g. "solar panels" or "water treatment".'),
      country_codes: z.string().optional().describe('Comma-separated ISO alpha-2 country codes to filter by (buyer/tender country).'),
      tender_start_from: z.string().optional().describe('Only leads with a tender start date on/after this date (YYYY-MM-DD).'),
      tender_start_to: z.string().optional().describe('Only leads with a tender start date on/before this date (YYYY-MM-DD).'),
      contract_start_from: z.string().optional().describe('Only leads with a contract start date on/after this date (YYYY-MM-DD).'),
      contract_start_to: z.string().optional().describe('Only leads with a contract start date on/before this date (YYYY-MM-DD).'),
      size: z.number().describe('Max results to return (1-50, default 20).'),
      wallet_address: z.string().describe('Agent wallet for x402 payment. Humans bypass automatically.'),
      payment_tx_hash: z.string().optional().describe('On-chain Base tx hash proving USDC payment to the operator (sovereign rail). Omit if using payment_header.'),
      payment_header: z.string().optional().describe('Base64 X-PAYMENT EIP-3009 payload, facilitator-settled (standard rail). Omit if using payment_tx_hash.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(TradeLeadsSchema, rawArgs);
      if (!RateLimiter.getInstance().checkTool('search_trade_leads')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      await PriceRegistry.getInstance().seedDefaults();
      const price = await PriceRegistry.getInstance().getPrice('search_trade_leads');
      if (!price) return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable' }) }], isError: true };
      let payment;
      try {
        payment = await executeX402Payment({ price, currency: 'USDC', toolName: 'search_trade_leads', walletAddress: args.wallet_address, paymentTxHash: args.payment_tx_hash, paymentHeader: args.payment_header });
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }
      const params = new URLSearchParams({ size: String(args.size ?? 20) });
      if (args.q) params.set('q', args.q);
      if (args.country_codes) params.set('country_codes', args.country_codes);
      if (args.tender_start_from) params.set('tender_start_date_range[from]', args.tender_start_from);
      if (args.tender_start_to) params.set('tender_start_date_range[to]', args.tender_start_to);
      if (args.contract_start_from) params.set('contract_start_date_range[from]', args.contract_start_from);
      if (args.contract_start_to) params.set('contract_start_date_range[to]', args.contract_start_to);
      const meta = { receipt_id: payment.receiptId, tx_hash: payment.txHash, chain: payment.chain, amount_paid: `${payment.amountPaid} ${payment.currency}` };
      try {
        const resp = await fetch(`${TRADE_LEADS_URL}?${params.toString()}`, { headers: { Accept: 'application/json' } });
        if (!resp.ok) {
          const body = await resp.text();
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'trade_leads_api_error', status: resp.status, detail: Sandbox.sanitizeApiResponse(body).slice(0, 300), _meta: meta }) }], isError: true };
        }
        const json: any = await resp.json();
        const results = json?.results ?? [];
        audit.info('search_trade_leads_success', { q: args.q ?? '', count: results.length, receiptId: payment.receiptId });
        return { content: [{ type: 'text', text: JSON.stringify({ source: 'trade.gov/trade_leads', total: json?.total ?? results.length, results, _meta: meta }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'trade_leads_fetch_failed', message: String(err), _meta: meta }) }], isError: true };
      }
    },
  );
}
