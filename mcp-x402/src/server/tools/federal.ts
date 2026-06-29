import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { PriceRegistry } from '../registry/pricing.js';

const GRANTS_URL = 'https://api.grants.gov/v1/api/search2';
const SAM_OPP_URL = 'https://api.sam.gov/opportunities/v2/search';
const SAM_ENTITY_URL = 'https://api.sam.gov/entity-information/v3/entities';

const SET_ASIDE_CODES: Record<string, string> = {
  SDVOSB: 'SDVOSBC', '8A': '8A', WOSB: 'WOSB', HUBZONE: 'HZC', SBA: 'SBA',
};

function samDate(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function meta(p: any): Record<string, string> {
  return { receipt_id: p.receiptId, tx_hash: p.txHash, chain: p.chain, amount_paid: `${p.amountPaid} ${p.currency}` };
}

const GrantsSchema = z.object({
  keyword: z.string().min(1).max(200),
  opp_status: z.enum(['forecasted', 'posted', 'closed', 'archived']).default('posted'),
  rows: z.number().int().min(1).max(50).default(10),
  wallet_address: z.string().optional(),
});
const ContractsSchema = z.object({
  title: z.string().max(200).optional(),
  naics: z.string().max(10).optional(),
  set_aside: z.enum(['SDVOSB', '8A', 'WOSB', 'HUBZONE', 'SBA']).optional(),
  agency: z.string().max(120).optional(),
  days_back: z.number().int().min(1).max(365).default(90),
  limit: z.number().int().min(1).max(100).default(15),
  wallet_address: z.string().optional(),
});
const EntitySchema = z.object({
  uei: z.string().length(12),
  wallet_address: z.string().optional(),
});

export function registerFederal(server: McpServer): void {
  const audit = AuditLogger.getInstance();

  // ── search_grants ── PAID (Grants.gov Search2, real data) ───────────────────
  server.tool(
    'search_grants',
    {
      keyword: z.string().describe('Keywords or assistance listing (CFDA) number, e.g. "veteran cybersecurity" or "64.203".'),
      opp_status: z.enum(['forecasted', 'posted', 'closed', 'archived']).describe('Opportunity status filter. Default: posted (open now).'),
      rows: z.number().describe('Number of results to return (1-50, default 10).'),
      wallet_address: z.string().describe('Agent wallet for x402 payment. Humans bypass automatically.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(GrantsSchema, rawArgs);
      if (!RateLimiter.getInstance().checkTool('search_grants')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      await PriceRegistry.getInstance().seedDefaults();
      const price = await PriceRegistry.getInstance().getPrice('search_grants');
      if (!price) return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable' }) }], isError: true };
      let payment;
      try {
        payment = await executeX402Payment({ price, currency: 'USDC', toolName: 'search_grants', walletAddress: args.wallet_address });
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }
      try {
        const resp = await fetch(GRANTS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: args.keyword, oppStatuses: args.opp_status ?? 'posted', rows: args.rows ?? 10 }) });
        if (!resp.ok) return { content: [{ type: 'text', text: JSON.stringify({ error: 'grants_api_error', status: resp.status, _meta: meta(payment) }) }], isError: true };
        const json: any = await resp.json();
        const hits = json?.data?.oppHits ?? [];
        const results = hits.map((o: any) => ({ id: o.id, opportunity_number: o.number, title: o.title, agency: o.agency, cfda: o.cfdaList, open_date: o.openDate, close_date: o.closeDate, status: o.oppStatus, link: o.id ? `https://www.grants.gov/search-results-detail/${o.id}` : null }));
        audit.info('search_grants_success', { keyword: args.keyword, count: results.length, receiptId: payment.receiptId });
        return { content: [{ type: 'text', text: JSON.stringify({ source: 'grants.gov/search2', total: json?.data?.hitCount ?? results.length, results, _meta: meta(payment) }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'grants_fetch_failed', message: String(err), _meta: meta(payment) }) }], isError: true };
      }
    },
  );

  // ── search_contracts ── PAID (SAM.gov; key checked BEFORE charging) ─────────
  server.tool(
    'search_contracts',
    {
      title: z.string().describe('Title search term. NOTE: SAM.gov has no full-text keyword search — it matches on notice title only.'),
      naics: z.string().describe('NAICS code, e.g. 541511.'),
      set_aside: z.enum(['SDVOSB', '8A', 'WOSB', 'HUBZONE', 'SBA']).describe('Set-aside filter. SDVOSB and 8A are your certifications.'),
      agency: z.string().describe('Department/agency name filter (deptname), e.g. "VETERANS AFFAIRS".'),
      days_back: z.number().describe('How many days of postings to scan (1-365, default 90).'),
      limit: z.number().describe('Max results (1-100, default 15).'),
      wallet_address: z.string().describe('Agent wallet for x402 payment.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(ContractsSchema, rawArgs);
      if (!RateLimiter.getInstance().checkTool('search_contracts')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      const apiKey = process.env['SAM_API_KEY'];
      if (!apiKey) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'sam_api_key_missing', charged: false, help: 'Server operator must set SAM_API_KEY (free at sam.gov). No payment was taken.' }) }], isError: true };
      }
      await PriceRegistry.getInstance().seedDefaults();
      const price = await PriceRegistry.getInstance().getPrice('search_contracts');
      if (!price) return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable' }) }], isError: true };
      let payment;
      try {
        payment = await executeX402Payment({ price, currency: 'USDC', toolName: 'search_contracts', walletAddress: args.wallet_address });
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }
      const params = new URLSearchParams({ api_key: apiKey, postedFrom: samDate(args.days_back ?? 90), postedTo: samDate(0), limit: String(args.limit ?? 15), offset: '0' });
      if (args.title) params.set('title', args.title);
      if (args.naics) params.set('ncode', args.naics);
      if (args.agency) params.set('deptname', args.agency);
      if (args.set_aside) { const code = SET_ASIDE_CODES[args.set_aside]; if (code) params.set('typeOfSetAside', code); }
      try {
        const resp = await fetch(`${SAM_OPP_URL}?${params.toString()}`, { headers: { Accept: 'application/json' } });
        if (!resp.ok) {
          const body = await resp.text();
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'sam_api_error', status: resp.status, detail: Sandbox.sanitizeApiResponse(body).slice(0, 300), _meta: meta(payment) }) }], isError: true };
        }
        const json: any = await resp.json();
        const data = json?.opportunitiesData ?? [];
        const results = data.map((o: any) => ({ notice_id: o.noticeId, solicitation_number: o.solicitationNumber, title: o.title, agency: o.fullParentPathName ?? o.department, type: o.type, naics: o.naicsCode, set_aside: o.typeOfSetAsideDescription, posted_date: o.postedDate, response_deadline: o.responseDeadLine, contact: Array.isArray(o.pointOfContact) && o.pointOfContact[0] ? o.pointOfContact[0].email : null, link: o.uiLink ?? null }));
        audit.info('search_contracts_success', { naics: args.naics, set_aside: args.set_aside, count: results.length, receiptId: payment.receiptId });
        return { content: [{ type: 'text', text: JSON.stringify({ source: 'sam.gov/opportunities/v2', total: json?.totalRecords ?? results.length, results, _meta: meta(payment) }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'sam_fetch_failed', message: String(err), _meta: meta(payment) }) }], isError: true };
      }
    },
  );

  // ── lookup_entity ── PAID (SAM.gov; key checked BEFORE charging) ────────────
  server.tool(
    'lookup_entity',
    {
      uei: z.string().describe('12-character SAM Unique Entity Identifier (UEI).'),
      wallet_address: z.string().describe('Agent wallet for x402 payment.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(EntitySchema, rawArgs);
      if (!RateLimiter.getInstance().checkTool('lookup_entity')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded', retry_after: 60 }) }], isError: true };
      }
      const apiKey = process.env['SAM_API_KEY'];
      if (!apiKey) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'sam_api_key_missing', charged: false, help: 'Server operator must set SAM_API_KEY (free at sam.gov). No payment was taken.' }) }], isError: true };
      }
      await PriceRegistry.getInstance().seedDefaults();
      const price = await PriceRegistry.getInstance().getPrice('lookup_entity');
      if (!price) return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable' }) }], isError: true };
      let payment;
      try {
        payment = await executeX402Payment({ price, currency: 'USDC', toolName: 'lookup_entity', walletAddress: args.wallet_address });
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }
      const params = new URLSearchParams({ api_key: apiKey, ueiSAM: args.uei });
      try {
        const resp = await fetch(`${SAM_ENTITY_URL}?${params.toString()}`, { headers: { Accept: 'application/json' } });
        if (!resp.ok) return { content: [{ type: 'text', text: JSON.stringify({ error: 'sam_entity_error', status: resp.status, _meta: meta(payment) }) }], isError: true };
        const json: any = await resp.json();
        const e = json?.entityData?.[0];
        if (!e) return { content: [{ type: 'text', text: JSON.stringify({ error: 'not_found', uei: args.uei, _meta: meta(payment) }) }] };
        const reg = e.entityRegistration ?? {};
        const core = e.coreData ?? {};
        const result = { uei: reg.ueiSAM, legal_business_name: reg.legalBusinessName, registration_status: reg.registrationStatus, registration_expiration: reg.registrationExpirationDate, cage_code: reg.cageCode, naics: (e.assertions?.goodsAndServices?.naicsList ?? []).map((n: any) => n.naicsCode), physical_address: core.physicalAddress ?? null };
        audit.info('lookup_entity_success', { uei: args.uei, receiptId: payment.receiptId });
        return { content: [{ type: 'text', text: JSON.stringify({ source: 'sam.gov/entity-information/v3', entity: result, _meta: meta(payment) }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'entity_fetch_failed', message: String(err), _meta: meta(payment) }) }], isError: true };
      }
    },
  );
}
