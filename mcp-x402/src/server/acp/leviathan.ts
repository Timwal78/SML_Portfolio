/**
 * LEVIATHAN — Virtuals Protocol ACP Seller Agent
 * ScriptMasterLabs | mcp-x402
 *
 * 54 institutional-grade offerings backed by live routes in this server.
 * Buyers pay USDC on Base via Virtuals Protocol ACP v2.
 * Calls are forwarded to the appropriate backend with X-Leviathan-Key bypass
 * (for x402 federal-data routes) or X-API-Key (for SqueezeOS signal routes).
 *
 * Required env vars:
 *   ACP_WALLET_ADDRESS      — Virtuals agent wallet
 *   ACP_WALLET_ID           — from app.virtuals.io → Signers tab
 *   ACP_SIGNER_PRIVATE_KEY  — from app.virtuals.io → Signers tab
 *   LEVIATHAN_BYPASS_SECRET — must match this server's LEVIATHAN_BYPASS_SECRET
 *   LEVIATHAN_BASE_URL      — this server's public URL (default: https://mcp-x402.onrender.com)
 *   SQUEEZEOS_API_BASE      — SqueezeOS backend (default: https://squeezeos-api.onrender.com)
 *   SML_API_KEY             — SqueezeOS OPERATOR_API_KEY for X-API-Key auth
 */

import {
  AcpAgent,
  PrivyAlchemyEvmProviderAdapter,
  AssetToken,
} from '@virtuals-protocol/acp-node-v2';
import type { JobSession, JobRoomEntry, AgentMessage } from '@virtuals-protocol/acp-node-v2';
import { base } from '@account-kit/infra';

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const WALLET_ADDRESS = (
  process.env['ACP_WALLET_ADDRESS'] ?? '0x0f035c36c4ce65a6f1bf4370f779bac722d59004'
) as `0x${string}`;

const WALLET_ID = (process.env['ACP_WALLET_ID'] ?? '').trim();
const SIGNER_PRIVATE_KEY = (process.env['ACP_SIGNER_PRIVATE_KEY'] ?? '').trim().replace(/^["']|["']$/g, '');
const BYPASS_SECRET = process.env['LEVIATHAN_BYPASS_SECRET'] ?? '';
const MCP_BASE = (
  process.env['LEVIATHAN_BASE_URL'] ?? 'https://mcp-x402.onrender.com'
).replace(/\/$/, '');
const SQUEEZEOS_BASE = (
  process.env['SQUEEZEOS_API_BASE'] ?? 'https://squeezeos-api.onrender.com'
).replace(/\/$/, '');
const SML_API_KEY = process.env['SML_API_KEY'] ?? '';

// ─── OFFERINGS CATALOG (live routes only) ────────────────────────────────────

interface Offering {
  price: number;
  description: string;
}

export const OFFERINGS: Record<string, Offering> = {
  // ── SqueezeOS Intelligence (SqueezeOS backend) ─────────────────────────────
  'SqueezeOS Council (7-Agent AI)': {
    price: 0.10,
    description:
      'Full 7-agent AI council verdict for any equity symbol via SqueezeOS. ' +
      'Req: { symbol: string }',
  },
  'SqueezeOS BeastMode Full Scan': {
    price: 0.10,
    description:
      'SqueezeOS full multi-engine scan — 741-EMA stack + 365-EMA + TripleLock composite. ' +
      'Req: { symbol: string }',
  },
  'SqueezeOS Squeeze Signal (741-EMA)': {
    price: 0.02,
    description:
      'SqueezeOS 741-EMA stack alignment signal with squeeze_alert flag. ' +
      'Returns BULLISH HIGHWAY / BEARISH HIGHWAY / CONSOLIDATION. Req: { symbol: string }',
  },
  'SqueezeOS 365-Day EMA Signal': {
    price: 0.03,
    description:
      'Price position vs 365-day EMA anchor (ABOVE / BELOW). Req: { symbol: string }',
  },
  'SqueezeOS Triple Lock Signal': {
    price: 0.05,
    description:
      'SML Triple Lock three-engine consensus (LOCKED BULL / LOCKED BEAR / FORMING / UNLOCKED). ' +
      'Req: { symbol: string }',
  },
  'SqueezeOS Full Signal (Composite)': {
    price: 0.10,
    description:
      'All three SqueezeOS engines in one sovereign verdict (741 + 365 + TripleLock). ' +
      'Req: { symbol: string }',
  },
  // ── Federal Data Intelligence (this server's x402 routes) ─────────────────
  'Federal Grants Intel': {
    price: 0.02,
    description:
      'Live federal grants data from Grants.gov. Req: { query: string, limit?: number }',
  },
  'Corporate Filings Search': {
    price: 0.08,
    description:
      'SAM.gov federal contract awards and corporate filings search. ' +
      'Req: { query: string, type?: string }',
  },
  'Market Intelligence Feed': {
    price: 0.30,
    description:
      'Real-time market intelligence data feed via USAspending.gov. Req: { symbol: string }',
  },
  'FDA Drug Label Lookup': {
    price: 0.05,
    description: 'FDA drug label information via openFDA. Req: { drug: string }',
  },
  'FDA Drug Recall Alert': {
    price: 0.08,
    description:
      'FDA drug recall enforcement reports via openFDA. Req: { drug?: string, limit?: number }',
  },
  'NPI Provider Lookup': {
    price: 0.05,
    description: 'National Provider Identifier registry lookup. Req: { query: string }',
  },
  'Clinical Trials Search': {
    price: 0.08,
    description: 'ClinicalTrials.gov study search. Req: { query: string, status?: string }',
  },
  'SEC Insider Trade Intel': {
    price: 0.20,
    description: 'SEC Form 4 insider trading activity for any ticker. Req: { ticker: string }',
  },
  'FDA Adverse Events Report': {
    price: 0.08,
    description: 'FDA FAERS adverse events for a drug. Req: { drug: string }',
  },
  'SEC 8-K Real-Time Filings': {
    price: 0.25,
    description: 'Real-time SEC 8-K material event filings for any ticker. Req: { ticker: string }',
  },
  'Treasury Yield Curve Data': {
    price: 0.05,
    description: 'Current US Treasury yield curve (1M through 30Y). Req: {}',
  },
  'Entity Compliance Check': {
    price: 0.35,
    description:
      'SAM.gov registration status + exclusion flag + set-aside types + NAICS codes. ' +
      'Req: { uei: string } or { cage: string }',
  },
  'Agent Credit Score': {
    price: 0.20,
    description:
      'AI agent FICO-style reputation score (300–850). Submit behavioral signals or retrieve score. ' +
      'Req: { agent_id: string, action?: "get"|"report", tasks?: number, successes?: number, errors?: number, payments?: number }',
  },
  'AI Fact Check': {
    price: 0.15,
    description:
      'Grounding oracle — fact-checks a claim against live government/FDA/SEC/Treasury data. ' +
      'Req: { claim: string, domain?: string }',
  },
  // ── Existing x402 routes (SEC/Finance/Patent/Economic/Labor) ──────────────────
  'SEC 13F Institutional Holdings': {
    price: 0.25,
    description:
      'SEC EDGAR 13F-HR hedge fund and institutional quarterly position filings. ' +
      'Req: { cik?: string, name?: string }',
  },
  'Lobbying Disclosures': {
    price: 0.15,
    description:
      'Senate LDA lobbying disclosure filings — client, registrant, issue codes, and amounts. ' +
      'Req: { client?: string, registrant?: string, issue?: string, limit?: number }',
  },
  'Patent Search': {
    price: 0.10,
    description:
      'USPTO PatentsView patent search by keyword title or assignee company. ' +
      'Req: { query?: string, assignee?: string, limit?: number }',
  },
  'FRED Economic Indicators': {
    price: 0.08,
    description:
      'FRED economic indicator series (Federal Reserve Bank of St. Louis) — GDP, CPI, UNRATE, FEDFUNDS, and 800k+ others. ' +
      'Req: { series_id: string, limit?: number }',
  },
  'OSHA Inspection Records': {
    price: 0.10,
    description:
      'OSHA workplace inspection and violation records (DOL enforcement data). ' +
      'Req: { establishment?: string, naics?: string, state?: string, limit?: number }',
  },
  'FDA 510k Device Clearances': {
    price: 0.08,
    description:
      'FDA 510(k) medical device premarket clearances (openFDA). ' +
      'Req: { device?: string, applicant?: string, limit?: number }',
  },
  // ── SqueezeOS extended intelligence routes ────────────────────────────────────
  'SqueezeOS Oracle Directive': {
    price: 0.15,
    description:
      'SqueezeOS OracleEngine sovereign directive for any symbol (BUY/HOLD/SELL/SHIELD + regime). ' +
      'Req: { symbol: string }',
  },
  'SqueezeOS Signal History': {
    price: 0.05,
    description:
      'SqueezeOS in-memory signal history ring buffer (last 200 signals for a symbol). ' +
      'Req: { symbol: string }',
  },
  'SqueezeOS IWM 0DTE Scorer': {
    price: 0.03,
    description:
      'SqueezeOS IWM zero-day-to-expiry contract scorer and directional bias. ' +
      'Req: {}',
  },
  'SqueezeOS Full Scanner': {
    price: 0.05,
    description:
      'SqueezeOS full $1–$50 squeeze scanner — 741-EMA, gamma walls, and pressure index. ' +
      'Req: {}',
  },
  // ── New x402 routes ───────────────────────────────────────────────────────────
  'SEC 10-K Annual Filing': {
    price: 0.20,
    description:
      'SEC EDGAR 10-K annual report filing history by ticker. Links to full 10-K documents on sec.gov. ' +
      'Req: { ticker: string, limit?: number }',
  },
  'SEC 10-Q Quarterly Filing': {
    price: 0.15,
    description:
      'SEC EDGAR 10-Q quarterly report filing history by ticker. Links to full 10-Q documents on sec.gov. ' +
      'Req: { ticker: string, limit?: number }',
  },
  'SEC 13D/13G Activist Filings': {
    price: 0.20,
    description:
      'SEC EDGAR 13D and 13G activist investor filings — who holds 5%+ stakes in a company. ' +
      'Req: { ticker: string, limit?: number }',
  },
  'FINRA BrokerCheck': {
    price: 0.15,
    description:
      'FINRA BrokerCheck broker/advisor registration status and disclosure history. ' +
      'Req: { name: string, type?: "individual"|"firm" }',
  },
  'FEC Campaign Finance': {
    price: 0.10,
    description:
      'FEC campaign finance — candidates, committees, and contribution totals by election cycle. ' +
      'Req: { name?: string, committee?: string, cycle?: string }',
  },
  'EPA Environmental Violations': {
    price: 0.12,
    description:
      'EPA ECHO enforcement and environmental violation records — facility inspections and penalties. ' +
      'Req: { facility?: string, state?: string, naics?: string }',
  },
  'SBIR/STTR Innovation Grants': {
    price: 0.05,
    description:
      'SBIR/STTR small business innovation research grants from SBA. ' +
      'Req: { keyword: string, agency?: string, phase?: "1"|"2", limit?: number }',
  },
  'Congressional Bills Search': {
    price: 0.08,
    description:
      'Congress.gov bill search — legislation by keyword, congress number, and status. ' +
      'Req: { query: string, congress?: string, limit?: number }',
  },
  'FDA Warning Letters': {
    price: 0.10,
    description:
      'FDA warning letters — regulatory enforcement actions for violations of FDA regulations. ' +
      'Req: { company?: string, product?: string, limit?: number }',
  },
  'CMS Medicare Provider Data': {
    price: 0.10,
    description:
      'CMS Medicare hospital quality data (ratings, emergency services) or physician provider information. ' +
      'Req: { name?: string, state?: string, type?: "hospital"|"physician", limit?: number }',
  },
  'NIH Research Grants': {
    price: 0.05,
    description:
      'NIH Reporter research grant database — active NIH grants by keyword and institute (NCI, NHLBI, NIAID, etc). ' +
      'Req: { query: string, agency?: string, fiscal_year?: number, limit?: number }',
  },
  // ── New SqueezeOS routes (require operator-key bypass fix — SqueezeOS PR #249/#250) ──
  'FTD Threshold List': {
    price: 0.02,
    description:
      'Current SEC Reg SHO Threshold Securities List (persistent fails-to-deliver). Req: {}',
  },
  'FTD Time Series': {
    price: 0.02,
    description:
      'Historical SEC Reg SHO fails-to-deliver time series for a symbol (default 90 days, max 180). ' +
      'Req: { symbol: string, limit?: number }',
  },
  'FTD Ratio': {
    price: 0.03,
    description:
      'Latest FTD record plus percentile rank within the rolling window, and threshold-list status. ' +
      'Req: { symbol: string }',
  },
  'FTD ETF Basket Concentration': {
    price: 0.05,
    description:
      'ETF constituents ranked by current FTD notional (supported: XRT, IWM, IJR, KRE). Req: { etf: string }',
  },
  'FTD Settlement Cycle': {
    price: 0.05,
    description:
      'Settlement-cycle descriptive bundle — FTD stats, threshold-list status, T+21/T+35 calendar markers, ' +
      'Reg SHO 204 13-day marker. Req: { symbol: string }',
  },
  'Options Flow Intelligence': {
    price: 0.05,
    description:
      'Institutional options flow — sweeps, whale detection, unusual volume, dark-pool prints (Tradier brokerage-grade). ' +
      'Req: { symbol?: string } (default IWM)',
  },
  'CASCADE Accumulator Signal': {
    price: 0.25,
    description:
      'CASCADE ACCUMULATOR directive — ACCUMULATE/PYRAMID/EXIT/STOP mode for a symbol. Req: { symbol: string }',
  },
  'IAM Inevitable Action Model': {
    price: 0.05,
    description:
      'Inevitable Action Model resolution — obligation committee verdict, Truth Layer state, and mandatory action. ' +
      'Req: { symbol: string }',
  },
  'Compliance Anomaly Report': {
    price: 5.00,
    description:
      'Submit a bank compliance anomaly to the Leviathan Matrix swarm for scoring. ' +
      'Req: { bank_id: string, agent_id: string, trigger: string, detail: string, severity?: string }',
  },
  'Compliance Bank Audit': {
    price: 5.00,
    description:
      'Full Leviathan Matrix compliance audit cycle for a bank. Req: { bank_id: string }',
  },
  'Compliance Regulator Query': {
    price: 2.50,
    description:
      'Real-time regulator compliance dashboard query for a bank. Req: { bank_id: string }',
  },
  'SqueezeOS Max-Conviction Rare Signal': {
    price: 0.25,
    description:
      'TRIPLE_LOCK_VERDICT — distinct from and rarer than the standard Triple Lock Signal job above. ' +
      'Returns BULL or BEAR only when three independent proprietary engines (macro price stretch, dark-pool ' +
      'volume kinetics, ribbon harmonics) all agree; otherwise NO_TRIPLE_LOCK with the blocking engine named. ' +
      'Req: { symbol: string }',
  },
  'Content & Wallet Trust Score': {
    price: 0.01,
    description:
      'Content misinformation trust scoring and on-chain wallet trust ledger — distinct mechanism from AI Fact Check ' +
      '(which cross-references live government data; this scores text content and sender wallet reputation). ' +
      'Req: { content: string, sender_wallet?: string }',
  },
};

// ─── BACKEND ROUTING ─────────────────────────────────────────────────────────

type Requirement = Record<string, string | number | boolean | undefined>;

async function callMcp(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, string>,
): Promise<unknown> {
  let url = `${MCP_BASE}${path}`;
  if (query && Object.keys(query).length > 0) {
    url = `${url}?${new URLSearchParams(query).toString()}`;
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Agent-DID': 'did:leviathan:acp:scriptmasterlabs',
  };
  if (BYPASS_SECRET) headers['X-Leviathan-Key'] = BYPASS_SECRET;

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '(unreadable)');
    throw new Error(`mcp-x402 ${method} ${path} → HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function callSqueezeOS(path: string): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (SML_API_KEY) headers['X-API-Key'] = SML_API_KEY;

  const res = await fetch(`${SQUEEZEOS_BASE}${path}`, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '(unreadable)');
    throw new Error(`SqueezeOS GET ${path} → HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function callSqueezeOSPost(path: string, body: Record<string, unknown>): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (SML_API_KEY) headers['X-API-Key'] = SML_API_KEY;

  const res = await fetch(`${SQUEEZEOS_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '(unreadable)');
    throw new Error(`SqueezeOS POST ${path} → HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function routeOffering(offering: string, req: Requirement): Promise<unknown> {
  const str = (v: string | number | boolean | undefined, fallback = ''): string =>
    v !== undefined ? String(v) : fallback;

  switch (offering) {
    // ── SqueezeOS (via SqueezeOS API) ─────────────────────────────────────────
    case 'SqueezeOS Council (7-Agent AI)':
    case 'SqueezeOS BeastMode Full Scan':
      return callSqueezeOSPost('/api/council', { symbol: str(req.symbol, 'SPY').toUpperCase() });

    case 'SqueezeOS Squeeze Signal (741-EMA)':
      return callSqueezeOS(`/api/signals/741/${encodeURIComponent(str(req.symbol, 'SPY').toUpperCase())}`);

    case 'SqueezeOS 365-Day EMA Signal':
      return callSqueezeOS(`/api/signals/365/${encodeURIComponent(str(req.symbol, 'SPY').toUpperCase())}`);

    case 'SqueezeOS Triple Lock Signal':
      return callSqueezeOS(`/api/signals/triplelock/${encodeURIComponent(str(req.symbol, 'SPY').toUpperCase())}`);

    case 'SqueezeOS Full Signal (Composite)':
      return callSqueezeOS(`/api/signals/full/${encodeURIComponent(str(req.symbol, 'SPY').toUpperCase())}`);

    // ── Federal data (via mcp-x402 x402 routes with bypass) ───────────────────
    case 'Federal Grants Intel':
      return callMcp('GET', '/x402/grants', undefined, {
        query: str(req.query),
        ...(req.limit ? { limit: str(req.limit) } : {}),
      });

    case 'Corporate Filings Search':
      return callMcp('GET', '/x402/firms', undefined, {
        query: str(req.query),
        ...(req.type ? { type: str(req.type) } : {}),
      });

    case 'Market Intelligence Feed':
      return callMcp('GET', '/x402/market', undefined, { symbol: str(req.symbol) });

    case 'FDA Drug Label Lookup':
      return callMcp('GET', '/x402/drug-label', undefined, { drug: str(req.drug) });

    case 'FDA Drug Recall Alert':
      return callMcp('GET', '/x402/drug-recall', undefined, {
        ...(req.drug ? { drug: str(req.drug) } : {}),
        ...(req.limit ? { limit: str(req.limit) } : {}),
      });

    case 'NPI Provider Lookup':
      return callMcp('GET', '/x402/npi', undefined, { query: str(req.query) });

    case 'Clinical Trials Search':
      return callMcp('GET', '/x402/clinical-trials', undefined, {
        query: str(req.query),
        ...(req.status ? { status: str(req.status) } : {}),
      });

    case 'SEC Insider Trade Intel':
      return callMcp('GET', '/x402/insider-trades', undefined, { ticker: str(req.ticker) });

    case 'FDA Adverse Events Report':
      return callMcp('GET', '/x402/drug-adverse-events', undefined, { drug: str(req.drug) });

    case 'SEC 8-K Real-Time Filings':
      return callMcp('GET', '/x402/sec-8k', undefined, { ticker: str(req.ticker) });

    case 'Treasury Yield Curve Data':
      return callMcp('GET', '/x402/treasury-yields');

    case 'Entity Compliance Check':
      return callMcp('GET', '/x402/entity-compliance', undefined, {
        ...(req.uei ? { uei: str(req.uei) } : {}),
        ...(req.cage ? { cage: str(req.cage) } : {}),
      });

    case 'Agent Credit Score':
      return callMcp('GET', '/x402/agent-score', undefined, {
        agent_id: str(req.agent_id),
        ...(req.action ? { action: str(req.action) } : {}),
        ...(req.tasks ? { tasks: str(req.tasks) } : {}),
        ...(req.successes ? { successes: str(req.successes) } : {}),
        ...(req.errors ? { errors: str(req.errors) } : {}),
        ...(req.payments ? { payments: str(req.payments) } : {}),
      });

    case 'AI Fact Check':
      return callMcp('GET', '/x402/fact-check', undefined, {
        claim: str(req.claim),
        ...(req.domain ? { domain: str(req.domain) } : {}),
      });

    // ── Existing x402 routes (previously missing from routeOffering) ──────────
    case 'SEC 13F Institutional Holdings':
      return callMcp('GET', '/x402/sec-13f', undefined, {
        ...(req.cik ? { cik: str(req.cik) } : {}),
        ...(req.name ? { name: str(req.name) } : {}),
      });

    case 'Lobbying Disclosures':
      return callMcp('GET', '/x402/lobbying', undefined, {
        ...(req.client ? { client: str(req.client) } : {}),
        ...(req.registrant ? { registrant: str(req.registrant) } : {}),
        ...(req.issue ? { issue: str(req.issue) } : {}),
        ...(req.limit ? { limit: str(req.limit) } : {}),
      });

    case 'Patent Search':
      return callMcp('GET', '/x402/patents', undefined, {
        ...(req.query ? { query: str(req.query) } : {}),
        ...(req.assignee ? { assignee: str(req.assignee) } : {}),
        ...(req.limit ? { limit: str(req.limit) } : {}),
      });

    case 'FRED Economic Indicators':
      return callMcp('GET', '/x402/fred', undefined, {
        series_id: str(req.series_id, 'GDP'),
        ...(req.limit ? { limit: str(req.limit) } : {}),
      });

    case 'OSHA Inspection Records':
      return callMcp('GET', '/x402/osha', undefined, {
        ...(req.establishment ? { establishment: str(req.establishment) } : {}),
        ...(req.naics ? { naics: str(req.naics) } : {}),
        ...(req.state ? { state: str(req.state) } : {}),
        ...(req.limit ? { limit: str(req.limit) } : {}),
      });

    case 'FDA 510k Device Clearances':
      return callMcp('GET', '/x402/fda-510k', undefined, {
        ...(req.device ? { device: str(req.device) } : {}),
        ...(req.applicant ? { applicant: str(req.applicant) } : {}),
        ...(req.limit ? { limit: str(req.limit) } : {}),
      });

    // ── SqueezeOS extended intelligence routes ────────────────────────────────
    case 'SqueezeOS Oracle Directive':
      return callSqueezeOS(`/api/oracle/${encodeURIComponent(str(req.symbol, 'SPY').toUpperCase())}`);

    case 'SqueezeOS Signal History':
      return callSqueezeOS(`/api/history/${encodeURIComponent(str(req.symbol, 'SPY').toUpperCase())}`);

    case 'SqueezeOS IWM 0DTE Scorer':
      return callSqueezeOS('/api/iwm');

    case 'SqueezeOS Full Scanner':
      return callSqueezeOS('/api/scan');

    // ── New x402 routes ────────────────────────────────────────────────────────
    case 'SEC 10-K Annual Filing':
      return callMcp('GET', '/x402/sec-10k', undefined, {
        ticker: str(req.ticker, str(req.symbol)),
        ...(req.limit ? { limit: str(req.limit) } : {}),
      });

    case 'SEC 10-Q Quarterly Filing':
      return callMcp('GET', '/x402/sec-10q', undefined, {
        ticker: str(req.ticker, str(req.symbol)),
        ...(req.limit ? { limit: str(req.limit) } : {}),
      });

    case 'SEC 13D/13G Activist Filings':
      return callMcp('GET', '/x402/sec-13dg', undefined, {
        ticker: str(req.ticker, str(req.symbol)),
        ...(req.limit ? { limit: str(req.limit) } : {}),
      });

    case 'FINRA BrokerCheck':
      return callMcp('GET', '/x402/finra-broker', undefined, {
        name: str(req.name),
        ...(req.type ? { type: str(req.type) } : {}),
      });

    case 'FEC Campaign Finance':
      return callMcp('GET', '/x402/fec-finance', undefined, {
        ...(req.name ? { name: str(req.name) } : {}),
        ...(req.committee ? { committee: str(req.committee) } : {}),
        ...(req.cycle ? { cycle: str(req.cycle) } : {}),
      });

    case 'EPA Environmental Violations':
      return callMcp('GET', '/x402/epa-violations', undefined, {
        ...(req.facility ? { facility: str(req.facility) } : {}),
        ...(req.state ? { state: str(req.state) } : {}),
        ...(req.naics ? { naics: str(req.naics) } : {}),
      });

    case 'SBIR/STTR Innovation Grants':
      return callMcp('GET', '/x402/sbir-grants', undefined, {
        keyword: str(req.keyword, str(req.query)),
        ...(req.agency ? { agency: str(req.agency) } : {}),
        ...(req.phase ? { phase: str(req.phase) } : {}),
        ...(req.limit ? { limit: str(req.limit) } : {}),
      });

    case 'Congressional Bills Search':
      return callMcp('GET', '/x402/congress-bills', undefined, {
        query: str(req.query),
        ...(req.congress ? { congress: str(req.congress) } : {}),
        ...(req.limit ? { limit: str(req.limit) } : {}),
      });

    case 'FDA Warning Letters':
      return callMcp('GET', '/x402/fda-warnings', undefined, {
        ...(req.company ? { company: str(req.company) } : {}),
        ...(req.product ? { product: str(req.product) } : {}),
        ...(req.limit ? { limit: str(req.limit) } : {}),
      });

    case 'CMS Medicare Provider Data':
      return callMcp('GET', '/x402/cms-providers', undefined, {
        ...(req.name ? { name: str(req.name) } : {}),
        ...(req.state ? { state: str(req.state) } : {}),
        ...(req.type ? { type: str(req.type) } : {}),
        ...(req.limit ? { limit: str(req.limit) } : {}),
      });

    case 'NIH Research Grants':
      return callMcp('GET', '/x402/nih-grants', undefined, {
        query: str(req.query),
        ...(req.agency ? { agency: str(req.agency) } : {}),
        ...(req.fiscal_year ? { fiscal_year: str(req.fiscal_year) } : {}),
        ...(req.limit ? { limit: str(req.limit) } : {}),
      });

    // ── New SqueezeOS routes ──────────────────────────────────────────────────
    case 'FTD Threshold List':
      return callSqueezeOS('/api/ftd/threshold-list');

    case 'FTD Time Series':
      return callSqueezeOS(
        `/api/ftd/series/${encodeURIComponent(str(req.symbol).toUpperCase())}` +
        (req.limit ? `?limit=${encodeURIComponent(str(req.limit))}` : ''),
      );

    case 'FTD Ratio':
      return callSqueezeOS(`/api/ftd/ratio/${encodeURIComponent(str(req.symbol).toUpperCase())}`);

    case 'FTD ETF Basket Concentration':
      return callSqueezeOS(`/api/ftd/etf-basket/${encodeURIComponent(str(req.etf).toUpperCase())}`);

    case 'FTD Settlement Cycle':
      return callSqueezeOS(`/api/ftd/cycle/${encodeURIComponent(str(req.symbol).toUpperCase())}`);

    case 'Options Flow Intelligence':
      return callSqueezeOS(`/api/options?symbol=${encodeURIComponent(str(req.symbol, 'IWM').toUpperCase())}`);

    case 'CASCADE Accumulator Signal':
      return callSqueezeOSPost('/api/cascade/signal', { symbol: str(req.symbol).toUpperCase() });

    case 'IAM Inevitable Action Model':
      return callSqueezeOS(`/api/iam/${encodeURIComponent(str(req.symbol).toUpperCase())}`);

    case 'Compliance Anomaly Report':
      return callSqueezeOSPost('/api/compliance/anomaly', {
        bank_id: str(req.bank_id),
        agent_id: str(req.agent_id),
        trigger: str(req.trigger),
        detail: str(req.detail),
        ...(req.severity ? { severity: str(req.severity) } : {}),
      });

    case 'Compliance Bank Audit':
      return callSqueezeOSPost('/api/compliance/audit', { bank_id: str(req.bank_id) });

    case 'Compliance Regulator Query':
      return callSqueezeOS(`/api/compliance/regulator/query/${encodeURIComponent(str(req.bank_id))}`);

    case 'SqueezeOS Max-Conviction Rare Signal':
      return callSqueezeOSPost('/api/triple-lock', { symbol: str(req.symbol).toUpperCase() });

    case 'Content & Wallet Trust Score':
      return callSqueezeOSPost('/api/ccs/validate', {
        content: str(req.content),
        ...(req.sender_wallet ? { sender_wallet: str(req.sender_wallet) } : {}),
      });

    default:
      throw new Error(`Unknown offering: ${offering}`);
  }
}

function extractRequirement(session: JobSession): Requirement {
  for (const entry of session.entries) {
    if (entry.kind === 'message' && entry.contentType === 'requirement') {
      try {
        return JSON.parse(entry.content) as Requirement;
      } catch {
        return {};
      }
    }
  }
  return {};
}

// ─── ENTRY HANDLER ───────────────────────────────────────────────────────────

/**
 * ACP job.description is a free-text field set at import time and echoed back
 * verbatim on the on-chain job. OFFERINGS keys are the canonical short titles
 * used for routing. Exact match handles the historical short-title imports;
 * the prefix fallback handles longer marketing copy (title + " — " + Triggers
 * keywords) that ACP may store as the job description, so long as it still
 * begins with the exact canonical title.
 */
// Buyers/listings on the Virtuals marketplace echo back whatever description
// string was used when the product was listed (e.g. "squeezeos_triple_lock_signal"),
// which may not match OFFERINGS' Title Case keys byte-for-byte even though it's
// clearly the same product — normalize away case/spacing/punctuation before
// falling back to "no such offering".
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const NORMALIZED_KEYS: ReadonlyArray<readonly [string, string]> =
  Object.keys(OFFERINGS).map((key) => [normalize(key), key] as const);

// Registered Virtuals job ids whose normalization diverges from the display key
// (e.g. "sec_13dg" → "sec13dg" but the catalog key "SEC 13D/13G" → "sec13d13g").
const OFFERING_ALIASES: Record<string, string> = {
  sec13dgactivistfilings: 'SEC 13D/13G Activist Filings',
};

export function resolveOffering(rawDescription: string): { key: string; spec: Offering } | undefined {
  const exact = OFFERINGS[rawDescription];
  if (exact) return { key: rawDescription, spec: exact };

  let best: { key: string; spec: Offering } | undefined;
  for (const [key, spec] of Object.entries(OFFERINGS)) {
    if (rawDescription.startsWith(key) && (!best || key.length > best.key.length)) {
      best = { key, spec };
    }
  }
  if (best) return best;

  const normalizedDesc = normalize(rawDescription);
  const aliasKey = OFFERING_ALIASES[normalizedDesc];
  if (aliasKey && OFFERINGS[aliasKey]) return { key: aliasKey, spec: OFFERINGS[aliasKey]! };
  const normalizedExact = NORMALIZED_KEYS.find(([norm]) => norm === normalizedDesc);
  if (normalizedExact) return { key: normalizedExact[1], spec: OFFERINGS[normalizedExact[1]]! };

  for (const [normKey, key] of NORMALIZED_KEYS) {
    if (normalizedDesc.startsWith(normKey) && (!best || key.length > best.key.length)) {
      best = { key, spec: OFFERINGS[key]! };
    }
  }
  return best;
}

async function handleEntry(session: JobSession, entry: JobRoomEntry): Promise<void> {
  if (entry.kind === 'system') {
    if (entry.event.type === 'job.funded') {
      const rawDescription = session.job?.description ?? '';
      const resolved = resolveOffering(rawDescription);
      const requirement = extractRequirement(session);
      try {
        if (!resolved) throw new Error(`Unknown offering: ${rawDescription}`);
        const result = await routeOffering(resolved.key, requirement);
        await session.submit(JSON.stringify(result));
      } catch (err) {
        await session.reject(`LEVIATHAN error: ${(err as Error).message}`);
      }
    }
    return;
  }

  if (entry.kind === 'message' && entry.contentType === 'requirement' && session.status === 'open') {
    const msgEntry = entry as AgentMessage;
    const rawDescription = session.job?.description ?? '';
    const resolved = resolveOffering(rawDescription);
    if (!resolved) {
      await session.reject(`LEVIATHAN does not offer: ${rawDescription}`);
      return;
    }
    if (resolved.spec.price > 0) {
      await session.setBudget(AssetToken.usdc(resolved.spec.price, session.chainId));
    }
    void msgEntry;
  }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

export async function startLeviathan(): Promise<void> {
  if (!WALLET_ID || !SIGNER_PRIVATE_KEY) {
    throw new Error(
      'LEVIATHAN requires ACP_WALLET_ID and ACP_SIGNER_PRIVATE_KEY — ' +
      'get them from app.virtuals.io/acp/agents/ → Signers tab',
    );
  }
  if (!BYPASS_SECRET) {
    console.warn('[LEVIATHAN] LEVIATHAN_BYPASS_SECRET is not set — x402 gates will reject calls');
  }
  if (!SML_API_KEY) {
    console.warn('[LEVIATHAN] SML_API_KEY is not set — SqueezeOS signal calls will fail auth');
  }

  // Validate key format before handing to Privy — helps diagnose Render env var issues.
  const keyBytes = Buffer.from(SIGNER_PRIVATE_KEY, 'base64');
  console.log(`[LEVIATHAN] key bytes=${keyBytes.length} starts=${SIGNER_PRIVATE_KEY.slice(0,8)} ends=${SIGNER_PRIVATE_KEY.slice(-8)}`);
  if (keyBytes.indexOf(Buffer.from([0x04, 0x20])) === -1) {
    throw new Error(
      `Invalid wallet authorization private key — decoded to ${keyBytes.length} bytes, ` +
      `pattern 0x04 0x20 not found. Key may be truncated, URL-encoded, or wrong format.`,
    );
  }

  // Log raw ACP/Privy responses to diagnose auth failures.
  const _origFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const res = await _origFetch(input, init);
    if (url.includes('acp.virtuals.io') || url.includes('privy.io')) {
      const clone = res.clone();
      clone.text().then(body => {
        console.log(`[LEVIATHAN] ${init?.method ?? 'GET'} ${url} → ${res.status} ${body.slice(0, 400)}`);
      }).catch(() => {});
    }
    return res;
  };

  console.log(`[LEVIATHAN] walletId=${WALLET_ID} walletAddress=${WALLET_ADDRESS}`);
  let provider: Awaited<ReturnType<typeof PrivyAlchemyEvmProviderAdapter.create>>;
  try {
    provider = await PrivyAlchemyEvmProviderAdapter.create({
      walletAddress: WALLET_ADDRESS,
      walletId: WALLET_ID,
      // ACP SDK passes this directly to Privy's importPKCS8PrivateKey, which expects
      // PKCS#8 base64 — pass the key as-is from the Virtuals "Add Signer" UI.
      signerPrivateKey: SIGNER_PRIVATE_KEY as `0x${string}`,
      chains: [base],
    });
  } catch (err: unknown) {
    const e = err as Error & { details?: unknown; statusCode?: number; shortMessage?: string };
    console.error('[LEVIATHAN] PrivyAlchemyEvmProviderAdapter.create failed:', e.message,
      e.shortMessage ?? '', JSON.stringify(e.details ?? ''));
    throw err;
  }

  let seller: Awaited<ReturnType<typeof AcpAgent.create>>;
  try {
    seller = await AcpAgent.create({ provider });
  } catch (err: unknown) {
    const e = err as Error & { details?: unknown; statusCode?: number; shortMessage?: string };
    console.error('[LEVIATHAN] AcpAgent.create failed:', e.message,
      e.shortMessage ?? '', JSON.stringify(e.details ?? ''));
    throw err;
  }

  seller.on('entry', handleEntry);

  try {
    await seller.start(() => {
      console.log('LEVIATHAN online — 54 offerings on Virtuals ACP marketplace');
      console.log(`  wallet : ${WALLET_ADDRESS}`);
      console.log(`  mcp    : ${MCP_BASE}`);
      console.log(`  squeeze: ${SQUEEZEOS_BASE}`);
      console.log(`  bypass : ${BYPASS_SECRET ? 'configured' : 'WARNING: not set'}`);
      console.log(`  apikey : ${SML_API_KEY ? 'configured' : 'WARNING: not set'}`);
    });
  } catch (err: unknown) {
    const e = err as Error & { details?: unknown; statusCode?: number; shortMessage?: string };
    console.error('[LEVIATHAN] seller.start failed:', e.message,
      e.shortMessage ?? '', JSON.stringify(e.details ?? ''));
    throw err;
  }
}
