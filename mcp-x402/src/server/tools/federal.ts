import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { AuditLogger } from '../security/audit.js';
import { PriceRegistry } from '../registry/pricing.js';

/**
 * Federal Data Tools — ScriptMasterLabs x402
 *
 * Pay-per-call access to U.S. federal data sources:
 * BASIC  ($0.02): grants, npi, firms, osha, epa-violations, sbir-grants, agent-score
 * PRO    ($0.15): sec-8k/10k/10q/13f/13dg, insider-trades, drug-label/recall/adverse-events,
 *                 clinical-trials, lobbying, patents, finra-broker, fec-finance, congress-bills,
 *                 treasury-yields, entity-compliance, market, fact-check
 * ELITE  ($0.30): usaspending-awards, federal-grants, sba-awards
 * ELITE+ ($0.50): options-flow
 *
 * All tools follow the same x402 USDC payment pattern as existing tools (ftd.ts, squeezeos.ts).
 * No payment = payment_required error returned to the agent.
 */

// ── Shared helpers ─────────────────────────────────────────────────────────────

function buildQuery(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') q.set(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

async function proxyGet(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ScriptMasterLabs-mcp-x402/2.1', Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

async function proxyPost(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'ScriptMasterLabs-mcp-x402/2.1' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

async function runPaidTool(
  toolName: string,
  walletAddress: string | undefined,
  fn: () => Promise<unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const audit = AuditLogger.getInstance();
  if (!RateLimiter.getInstance().checkTool(toolName)) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded' }) }], isError: true };
  }
  await PriceRegistry.getInstance().seedDefaults();
  const price = await PriceRegistry.getInstance().getPrice(toolName);
  if (!price) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'price_unavailable' }) }], isError: true };
  }
  let payment;
  try {
    payment = await executeX402Payment({ price, currency: 'USDC', toolName, walletAddress });
  } catch (err) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
  }
  try {
    const data = await fn();
    audit.info(`${toolName}_success`, { receiptId: payment.receiptId });
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ data, tier: 'paid', _meta: { receipt_id: payment.receiptId, tx_hash: payment.txHash, chain: payment.chain, amount_paid: `${payment.amountPaid} ${payment.currency}` } }),
      }],
    };
  } catch (err) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'upstream_unavailable', details: String(err) }) }], isError: true };
  }
}

// ── Tool Registration ──────────────────────────────────────────────────────────

export function registerFederal(server: McpServer): void {

  // ── BASIC TIER ($0.02) ───────────────────────────────────────────────────────

  server.tool('federal_grants', {
    keyword: z.string().optional().describe('Keyword to search grants for (e.g. "AI", "veteran")'),
    agency: z.string().optional().describe('Awarding agency name (e.g. "Department of Defense")'),
    limit: z.string().optional().describe('Number of results (max 50). Default: 10'),
    wallet_address: z.string().optional().describe('Agent wallet address for USDC payment'),
  }, async (args) => runPaidTool('federal_grants', args.wallet_address, () =>
    proxyPost('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
      filters: { award_type_codes: ['02', '03', '04', '05'], ...(args.keyword ? { keywords: [args.keyword] } : {}), ...(args.agency ? { agencies: [{ type: 'awarding', tier: 'toptier', name: args.agency }] } : {}) },
      fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Awarding Agency', 'Award Date', 'Description'],
      sort: 'Award Amount', order: 'desc', limit: Math.min(parseInt(args.limit ?? '10') || 10, 50), page: 1,
    })
  ));

  server.tool('federal_npi_lookup', {
    number: z.string().optional().describe('NPI number (10-digit)'),
    first_name: z.string().optional().describe('Provider first name'),
    last_name: z.string().optional().describe('Provider last name'),
    organization_name: z.string().optional().describe('Organization name'),
    state: z.string().optional().describe('State abbreviation (e.g. "TX")'),
    limit: z.string().optional().describe('Number of results. Default: 10'),
    wallet_address: z.string().optional().describe('Agent wallet address for USDC payment'),
  }, async (args) => runPaidTool('federal_npi_lookup', args.wallet_address, () =>
    proxyGet(`https://npiregistry.cms.hhs.gov/api/${buildQuery({ number: args.number, first_name: args.first_name, last_name: args.last_name, organization_name: args.organization_name, state: args.state, limit: args.limit ?? '10', version: '2.1' })}`)
  ));

  server.tool('federal_sbir_grants', {
    keyword: z.string().optional().describe('Keyword search'),
    agency: z.string().optional().describe('Agency (e.g. "DOD", "NIH")'),
    firm: z.string().optional().describe('Company name'),
    year: z.string().optional().describe('Award year'),
    rows: z.string().optional().describe('Number of results. Default: 25'),
    wallet_address: z.string().optional().describe('Agent wallet address for USDC payment'),
  }, async (args) => runPaidTool('federal_sbir_grants', args.wallet_address, () =>
    proxyGet(`https://api.sbir.gov/public/awards${buildQuery({ keyword: args.keyword, agency: args.agency, firm: args.firm, year: args.year, rows: args.rows ?? '25', start: '0' })}`)
  ));

  server.tool('federal_osha', {
    establishment_name: z.string().optional().describe('Business name'),
    state: z.string().optional().describe('State abbreviation'),
    naics_code: z.string().optional().describe('NAICS industry code'),
    limit: z.string().optional().describe('Number of results. Default: 25'),
    wallet_address: z.string().optional().describe('Agent wallet address for USDC payment'),
  }, async (args) => runPaidTool('federal_osha', args.wallet_address, () =>
    proxyGet(`https://data.dol.gov/get/full_inspection${buildQuery({ establishment_name: args.establishment_name, state: args.state, naics_code: args.naics_code, p_start: '1', p_finish: args.limit ?? '25' })}`)
  ));

  server.tool('federal_epa_violations', {
    facility_name: z.string().optional().describe('Facility name'),
    state: z.string().optional().describe('State abbreviation'),
    limit: z.string().optional().describe('Number of results. Default: 25'),
    wallet_address: z.string().optional().describe('Agent wallet address for USDC payment'),
  }, async (args) => runPaidTool('federal_epa_violations', args.wallet_address, () =>
    proxyGet(`https://echo.epa.gov/rest/services/cwa/CWAFacilitiesSearch${buildQuery({ p_fn: args.facility_name, p_st: args.state, p_per: args.limit ?? '25', output: 'JSON' })}`)
  ));

  // ── PRO TIER ($0.15) ─────────────────────────────────────────────────────────

  server.tool('federal_drug_label', {
    drug: z.string().describe('Drug brand name (e.g. "Lipitor")'),
    limit: z.string().optional().describe('Number of results. Default: 5'),
    wallet_address: z.string().optional().describe('Agent wallet address for USDC payment'),
  }, async (args) => runPaidTool('federal_drug_label', args.wallet_address, () =>
    proxyGet(`https://api.fda.gov/drug/label.json${buildQuery({ search: `openfda.brand_name:"${args.drug}"`, limit: args.limit ?? '5' })}`)
  ));

  server.tool('federal_drug_recall', {
    drug: z.string().optional().describe('Drug product name to filter by'),
    limit: z.string().optional().describe('Number of results. Default: 10'),
    wallet_address: z.string().optional().describe('Agent wallet address for USDC payment'),
  }, async (args) => runPaidTool('federal_drug_recall', args.wallet_address, () =>
    proxyGet(`https://api.fda.gov/drug/enforcement.json${buildQuery({ search: args.drug ? `product_description:"${args.drug}"` : 'status:Ongoing', limit: args.limit ?? '10', sort: 'recall_initiation_date:desc' })}`)
  ));

  server.tool('federal_drug_adverse_events', {
    drug: z.string().describe('Drug medicinal name (e.g. "aspirin")'),
    limit: z.string().optional().describe('Number of results. Default: 10'),
    wallet_address: z.string().optional().describe('Agent wallet address for USDC payment'),
  }, async (args) => runPaidTool('federal_drug_adverse_events', args.wallet_address, () =>
    proxyGet(`https://api.fda.gov/drug/event.json${buildQuery({ search: `patient.drug.medicinalproduct:"${args.drug}"`, limit: args.limit ?? '10', sort: 'receivedate:desc' })}`)
  ));

  server.tool('federal_clinical_trials', {
    condition: z.string().optional().describe('Medical condition (e.g. "diabetes")'),
    intervention: z.string().optional().describe('Drug or intervention name'),
    status: z.string().optional().describe('Trial status (e.g. "RECRUITING")'),
    limit: z.string().optional().describe('Number of results. Default: 10'),
    wallet_address: z.string().optional().describe('Agent wallet address for USDC payment'),
  }, async (args) => runPaidTool('federal_clinical_trials', args.wallet_address, () =>
    proxyGet(`https://clinicaltrials.gov/api/v2/studies${buildQuery({ 'query.cond': args.condition, 'query.intr': args.intervention, 'filter.overallStatus': args.status, pageSize: args.limit ?? '10', format: 'json' })}`)
  ));

  server.tool('federal_sec_filings', {
    cik: z.string().describe('SEC CIK number (e.g. "0000320193" for Apple)'),
    wallet_address: z.string().optional().describe('Agent wallet address for USDC payment'),
  }, async (args) => runPaidTool('federal_sec_filings', args.wallet_address, () =>
    proxyGet(`https://data.sec.gov/submissions/CIK${args.cik.padStart(10, '0')}.json`)
  ));

  server.tool('federal_insider_trades', {
    ticker: z.string().describe('Stock ticker symbol (e.g. "AAPL")'),
    limit: z.string().optional().describe('Number of results. Default: 20'),
    wallet_address: z.string().optional().describe('Agent wallet address for USDC payment'),
  }, async (args) => runPaidTool('federal_insider_trades', args.wallet_address, () =>
    proxyGet(`https://openinsider.com/screener${buildQuery({ q: args.ticker, cnt: args.limit ?? '20', action: 'getInsiderTrades' })}`)
  ));

  server.tool('federal_lobbying', {
    client: z.string().optional().describe('Lobbying client/company name'),
    issue: z.string().optional().describe('Specific lobbying issue'),
    year: z.string().optional().describe('Filing year. Default: current year'),
    limit: z.string().optional().describe('Number of results. Default: 20'),
    wallet_address: z.string().optional().describe('Agent wallet address for USDC payment'),
  }, async (args) => runPaidTool('federal_lobbying', args.wallet_address, () =>
    proxyGet(`https://lda.senate.gov/api/v1/filings/${buildQuery({ client_name: args.client, specific_issue: args.issue, filing_year: args.year ?? String(new Date().getFullYear()), limit: args.limit ?? '20' })}`)
  ));

  server.tool('federal_patents', {
    assignee: z.string().optional().describe('Assignee/company name'),
    inventor: z.string().optional().describe('Inventor last name'),
    keyword: z.string().optional().describe('Keyword in patent abstract'),
    limit: z.string().optional().describe('Number of results. Default: 25'),
    wallet_address: z.string().optional().describe('Agent wallet address for USDC payment'),
  }, async (args) => runPaidTool('federal_patents', args.wallet_address, () => {
    const q: Record<string, string> = {};
    if (args.assignee) q['assignee_organization'] = args.assignee;
    if (args.inventor) q['inventor_last_name'] = args.inventor;
    if (args.keyword) q['patent_abstract'] = args.keyword;
    return proxyPost('https://search.patentsview.org/api/v1/patent/', {
      q, f: ['patent_id', 'patent_title', 'patent_date', 'assignee_organization', 'inventor_first_name', 'inventor_last_name'],
      o: { per_page: Math.min(parseInt(args.limit ?? '25') || 25, 100) },
    });
  }));

  server.tool('federal_finra_broker', {
    name: z.string().optional().describe('Broker or firm name'),
    crd: z.string().optional().describe('CRD number'),
    wallet_address: z.string().optional().describe('Agent wallet address for USDC payment'),
  }, async (args) => runPaidTool('federal_finra_broker', args.wallet_address, () =>
    proxyGet(`https://api.brokercheck.finra.org/search/individual${buildQuery({ query: args.name, crd_number: args.crd })}`)
  ));

  server.tool('federal_fec_finance', {
    name: z.string().optional().describe('Candidate name'),
    office: z.string().optional().describe('Office sought (H=House, S=Senate, P=President)'),
    party: z.string().optional().describe('Party (REP, DEM, etc.)'),
    state: z.string().optional().describe('State abbreviation'),
    cycle: z.string().optional().describe('Election cycle year. Default: 2024'),
    limit: z.string().optional().describe('Number of results. Default: 20'),
    wallet_address: z.string().optional().describe('Agent wallet address for USDC payment'),
  }, async (args) => runPaidTool('federal_fec_finance', args.wallet_address, () =>
    proxyGet(`https://api.open.fec.gov/v1/candidates/${buildQuery({ q: args.name, office: args.office, party: args.party, state: args.state, election_year: args.cycle ?? '2024', per_page: args.limit ?? '20', api_key: process.env['FEC_API_KEY'] ?? 'DEMO_KEY' })}`)
  ));

  server.tool('federal_congress_bills', {
    keyword: z.string().optional().describe('Keyword to search bills for'),
    congress: z.string().optional().describe('Congress number (e.g. "119"). Default: 119'),
    limit: z.string().optional().describe('Number of results. Default: 20'),
    wallet_address: z.string().optional().describe('Agent wallet address for USDC payment'),
  }, async (args) => runPaidTool('federal_congress_bills', args.wallet_address, () =>
    proxyGet(`https://api.congress.gov/v3/bill${buildQuery({ query: args.keyword, congress: args.congress ?? '119', limit: args.limit ?? '20', api_key: process.env['CONGRESS_GOV_API_KEY'] ?? 'DEMO_KEY', format: 'json' })}`)
  ));

  server.tool('federal_treasury_yields', {
    wallet_address: z.string().optional().describe('Agent wallet address for USDC payment'),
  }, async (args) => runPaidTool('federal_treasury_yields', args.wallet_address, async () => {
    const FRED_KEY = process.env['FRED_API_KEY'] ?? 'DEMO_KEY';
    const seriesIds = ['DGS1MO', 'DGS3MO', 'DGS6MO', 'DGS1', 'DGS2', 'DGS5', 'DGS10', 'DGS20', 'DGS30'];
    const results = await Promise.all(seriesIds.map(async (id) => {
      const r = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${id}&limit=1&sort_order=desc&api_key=${FRED_KEY}&file_type=json`, { signal: AbortSignal.timeout(8000) });
      const d = await r.json() as { observations?: Array<{ date: string; value: string }> };
      return { series: id, date: d.observations?.[0]?.date, yield: d.observations?.[0]?.value };
    }));
    return { source: 'FRED / US Treasury', yields: results };
  }));

  server.tool('federal_entity_compliance', {
    uei: z.string().optional().describe('SAM.gov UEI number'),
    cage: z.string().optional().describe('CAGE code'),
    name: z.string().optional().describe('Legal business name'),
    wallet_address: z.string().optional().describe('Agent wallet address for USDC payment'),
  }, async (args) => runPaidTool('federal_entity_compliance', args.wallet_address, () =>
    proxyGet(`https://api.sam.gov/entity-information/v3/entities${buildQuery({ ueiSAM: args.uei, cageCode: args.cage, legalBusinessName: args.name, includeSections: 'entityRegistration,repsAndCerts', api_key: process.env['SAM_GOV_API_KEY'] ?? '' })}`)
  ));

  // ── ELITE TIER ($0.30) ───────────────────────────────────────────────────────

  server.tool('federal_usaspending_awards', {
    keyword: z.string().optional().describe('Keyword (e.g. "cybersecurity", "AI")'),
    agency: z.string().optional().describe('Awarding agency name'),
    naics: z.string().optional().describe('NAICS code'),
    set_aside: z.string().optional().describe('Set-aside type (e.g. "SDVOSBC" for veteran-owned)'),
    recipient: z.string().optional().describe('Recipient/company name'),
    limit: z.string().optional().describe('Number of results (max 100). Default: 25'),
    wallet_address: z.string().optional().describe('Agent wallet address for USDC payment'),
  }, async (args) => runPaidTool('federal_usaspending_awards', args.wallet_address, () =>
    proxyPost('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
      filters: {
        award_type_codes: ['A', 'B', 'C', 'D'],
        ...(args.keyword ? { keywords: [args.keyword] } : {}),
        ...(args.agency ? { agencies: [{ type: 'awarding', tier: 'toptier', name: args.agency }] } : {}),
        ...(args.naics ? { naics_codes: [args.naics] } : {}),
        ...(args.set_aside ? { set_aside_types: [args.set_aside] } : {}),
        ...(args.recipient ? { recipient_search_text: [args.recipient] } : {}),
      },
      fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Total Outlays', 'Awarding Agency', 'Awarding Sub Agency', 'Contract Award Type', 'NAICS Code', 'NAICS Description', 'Award Date', 'Period of Performance Start Date', 'Period of Performance Current End Date', 'Place of Performance State Code', 'Description'],
      sort: 'Award Amount', order: 'desc',
      limit: Math.min(parseInt(args.limit ?? '25') || 25, 100), page: 1,
    })
  ));

  server.tool('federal_grants_gov', {
    keyword: z.string().optional().describe('Keyword search (e.g. "veteran", "small business")'),
    agency: z.string().optional().describe('Agency code'),
    cfda: z.string().optional().describe('CFDA number'),
    eligibility: z.string().optional().describe('Eligibility category'),
    limit: z.string().optional().describe('Number of results (max 100). Default: 25'),
    wallet_address: z.string().optional().describe('Agent wallet address for USDC payment'),
  }, async (args) => runPaidTool('federal_grants_gov', args.wallet_address, () =>
    proxyPost('https://apply07.grants.gov/grantsws/rest/opportunities/search/', {
      keyword: args.keyword ?? '',
      oppStatuses: 'forecasted|posted',
      ...(args.agency ? { agencies: args.agency } : {}),
      ...(args.cfda ? { cfdaNumbers: args.cfda } : {}),
      ...(args.eligibility ? { eligibilities: args.eligibility } : {}),
      rows: Math.min(parseInt(args.limit ?? '25') || 25, 100),
      sortBy: 'openDate|desc',
    })
  ));

  server.tool('federal_sba_awards', {
    keyword: z.string().optional().describe('Keyword search'),
    naics: z.string().optional().describe('NAICS code'),
    set_aside: z.string().optional().describe('Set-aside type. Default: SDVOSBC (veteran-owned)'),
    fiscal_year: z.string().optional().describe('Fiscal year. Default: 2024'),
    limit: z.string().optional().describe('Number of results (max 100). Default: 25'),
    wallet_address: z.string().optional().describe('Agent wallet address for USDC payment'),
  }, async (args) => runPaidTool('federal_sba_awards', args.wallet_address, () =>
    proxyPost('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
      filters: {
        award_type_codes: ['A', 'B', 'C', 'D'],
        set_aside_types: [args.set_aside ?? 'SDVOSBC'],
        ...(args.keyword ? { keywords: [args.keyword] } : {}),
        ...(args.naics ? { naics_codes: [args.naics] } : {}),
        time_period: [{ start_date: `${parseInt(args.fiscal_year ?? '2024') - 1}-10-01`, end_date: `${args.fiscal_year ?? '2024'}-09-30` }],
      },
      fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Awarding Agency', 'NAICS Code', 'NAICS Description', 'Award Date', 'Description', 'Place of Performance State Code'],
      sort: 'Award Amount', order: 'desc',
      limit: Math.min(parseInt(args.limit ?? '25') || 25, 100), page: 1,
    })
  ));

  // ── ELITE+ TIER ($0.50) ──────────────────────────────────────────────────────

  server.tool('federal_options_flow', {
    symbol: z.string().optional().describe('Ticker symbol (e.g. "SPY"). Default: SPY'),
    limit: z.string().optional().describe('Number of trades. Default: 50'),
    wallet_address: z.string().optional().describe('Agent wallet address for USDC payment'),
  }, async (args) => runPaidTool('federal_options_flow', args.wallet_address, async () => {
    const key = process.env['ALPACA_API_KEY'] ?? '';
    const secret = process.env['ALPACA_API_SECRET'] ?? '';
    if (!key) throw new Error('ALPACA_API_KEY not configured');
    const r = await fetch(`https://data.alpaca.markets/v1beta1/options/trades?symbols=${args.symbol ?? 'SPY'}&limit=${args.limit ?? '50'}`, {
      headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret },
      signal: AbortSignal.timeout(10000),
    });
    return r.json();
  }));
}
