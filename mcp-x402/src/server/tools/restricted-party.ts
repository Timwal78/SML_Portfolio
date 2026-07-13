import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { PriceRegistry } from '../registry/pricing.js';

// Trade.gov Consolidated Screening List — combines 11 US export-control /
// sanctions lists (BIS Denied Persons, Entity List, Military End User,
// Unverified List; State Dept ITAR Debarred + Nonproliferation Sanctions;
// Treasury OFAC SDN + 5 more) into one search. Confirmed against the real
// developer.trade.gov docs (not guessed): no API key required, this is a
// fully open public endpoint.
const CSL_URL = 'https://data.trade.gov/consolidated_screening_list/v1/search';

const ScreenSchema = z.object({
  name: z.string().min(1).max(200),
  fuzzy_name: z.boolean().default(false),
  sources: z.string().max(200).optional(),
  countries: z.string().max(200).optional(),
  size: z.number().int().min(1).max(50).default(20),
  wallet_address: z.string().optional(),
  payment_tx_hash: z.string().optional(),
  payment_header: z.string().optional(),
});

export function registerRestrictedParty(server: McpServer): void {
  const audit = AuditLogger.getInstance();

  // ── screen_restricted_party ── PAID (Consolidated Screening List, real data, no key needed) ──
  server.tool(
    'screen_restricted_party',
    {
      name: z.string().describe('Individual or entity name to screen, e.g. "Acme Exports LLC".'),
      fuzzy_name: z.boolean().describe('Enable fuzzy name matching for misspellings/variants. Default false.'),
      sources: z.string().optional().describe('Comma-separated source list abbreviations to restrict the search to: DPL (BIS Denied Persons), EL (BIS Entity List), MEU (BIS Military End User), UVL (BIS Unverified List), ISN (State Nonproliferation), DTC (State ITAR Debarred), SDN (Treasury OFAC), CAP, CMIC, FSE, MBS, PLC, SSI. Omit to search all 11 lists.'),
      countries: z.string().optional().describe('Comma-separated ISO alpha-2 country codes to filter by.'),
      size: z.number().describe('Max results to return (1-50, default 20).'),
      wallet_address: z.string().describe('Agent wallet for x402 payment. Humans bypass automatically.'),
      payment_tx_hash: z.string().optional().describe('On-chain Base tx hash proving USDC payment to the operator (sovereign rail). Omit if using payment_header.'),
      payment_header: z.string().optional().describe('Base64 X-PAYMENT EIP-3009 payload, facilitator-settled (standard rail). Omit if using payment_tx_hash.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(ScreenSchema, rawArgs);
      if (!RateLimiter.getInstance().checkTool('screen_restricted_party')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      await PriceRegistry.getInstance().seedDefaults();
      const price = await PriceRegistry.getInstance().getPrice('screen_restricted_party');
      if (!price) return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable' }) }], isError: true };
      let payment;
      try {
        payment = await executeX402Payment({ price, currency: 'USDC', toolName: 'screen_restricted_party', walletAddress: args.wallet_address, paymentTxHash: args.payment_tx_hash, paymentHeader: args.payment_header });
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }
      const params = new URLSearchParams({ name: args.name, size: String(args.size ?? 20) });
      if (args.fuzzy_name) params.set('fuzzy_name', 'true');
      if (args.sources) params.set('sources', args.sources);
      if (args.countries) params.set('countries', args.countries);
      const meta = { receipt_id: payment.receiptId, tx_hash: payment.txHash, chain: payment.chain, amount_paid: `${payment.amountPaid} ${payment.currency}` };
      try {
        const resp = await fetch(`${CSL_URL}?${params.toString()}`, { headers: { Accept: 'application/json' } });
        if (!resp.ok) {
          const body = await resp.text();
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'csl_api_error', status: resp.status, detail: Sandbox.sanitizeApiResponse(body).slice(0, 300), _meta: meta }) }], isError: true };
        }
        const json: any = await resp.json();
        const results = json?.results ?? [];
        const matches = results.map((r: any) => ({
          name: r.name,
          alt_names: r.alt_names ?? [],
          source: r.source,
          source_list_url: r.source_list_url,
          type: r.type,
          programs: r.programs ?? [],
          federal_register_notice: r.federal_register_notice,
          start_date: r.start_date,
          end_date: r.end_date,
          addresses: r.addresses ?? [],
        }));
        audit.info('screen_restricted_party_success', { name: args.name, matchCount: matches.length, receiptId: payment.receiptId });
        return { content: [{ type: 'text', text: JSON.stringify({ source: 'trade.gov/consolidated_screening_list', total: json?.total ?? matches.length, match_count: matches.length, matches, _meta: meta }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'csl_fetch_failed', message: String(err), _meta: meta }) }], isError: true };
      }
    },
  );
}
