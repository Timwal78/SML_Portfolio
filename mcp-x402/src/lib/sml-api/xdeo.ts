export interface XdeoEstimateParams {
  ticker: string;
  fiscalQuarter: string; // Q1YYYY..Q4YYYY
  estimateType: 'eps' | 'revenue' | 'guidance' | 'all';
}

interface AlphaVantageQuarterlyEarning {
  fiscalDateEnding: string;
  reportedDate?: string;
  reportedEPS?: string;
  estimatedEPS?: string;
  surprise?: string;
  surprisePercentage?: string;
}

const ALPHA_VANTAGE_BASE = 'https://www.alphavantage.co/query';

function quarterMonthRange(q: number): [number, number] {
  // 1-indexed months, standard calendar-quarter mapping. Real companies can
  // run offset fiscal years — this is a best-effort match against Alpha
  // Vantage's real fiscalDateEnding, not a guaranteed-exact lookup, and the
  // caller is told honestly when nothing matches.
  return [(q - 1) * 3 + 1, q * 3];
}

/** Finds the quarterlyEarnings entry whose real fiscalDateEnding falls in the requested Q/year window. */
function findQuarter(entries: AlphaVantageQuarterlyEarning[], fiscalQuarter: string): AlphaVantageQuarterlyEarning | null {
  const match = /^Q([1-4])(\d{4})$/.exec(fiscalQuarter);
  if (!match) return null;
  const q = Number(match[1]);
  const year = Number(match[2]);
  const [startMonth, endMonth] = quarterMonthRange(q);

  for (const e of entries) {
    const d = new Date(e.fiscalDateEnding);
    if (Number.isNaN(d.getTime())) continue;
    const month = d.getUTCMonth() + 1;
    if (d.getUTCFullYear() === year && month >= startMonth && month <= endMonth) {
      return e;
    }
  }
  return null;
}

export class XdeoClient {
  private static instance: XdeoClient;

  private constructor() {}

  static getInstance(): XdeoClient {
    if (!XdeoClient.instance) {
      XdeoClient.instance = new XdeoClient();
    }
    return XdeoClient.instance;
  }

  /**
   * Real earnings data from Alpha Vantage's free EARNINGS endpoint — fixed
   * 2026-08-01, previously called a dead host with no real backend
   * anywhere. Honest scope, disclosed rather than papered over:
   *  - "eps": real (estimatedEPS/reportedEPS/surprise), but Alpha Vantage's
   *    free EARNINGS endpoint only has data for quarters that have ALREADY
   *    reported — a genuinely future, unreported quarter honestly abstains
   *    rather than guessing a number.
   *  - "revenue": Alpha Vantage's free EARNINGS endpoint does not include
   *    revenue at all — always abstains, never fabricates a figure.
   *  - "guidance": no free, legitimate forward-guidance source exists
   *    anywhere in this account's infrastructure (confirmed by search) —
   *    always abstains.
   */
  async getEstimate(params: XdeoEstimateParams): Promise<unknown> {
    const apiKey = process.env['ALPHA_VANTAGE_API_KEY'];
    if (!apiKey) {
      return {
        status: 'unavailable',
        reason: 'ALPHA_VANTAGE_API_KEY not configured on this gateway — no real earnings-estimate source is reachable.',
        ticker: params.ticker,
        fiscal_quarter: params.fiscalQuarter,
      };
    }

    const url = `${ALPHA_VANTAGE_BASE}?function=EARNINGS&symbol=${encodeURIComponent(params.ticker)}&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      throw new Error(`Alpha Vantage EARNINGS fetch failed: HTTP ${res.status}`);
    }
    const json = (await res.json()) as { quarterlyEarnings?: AlphaVantageQuarterlyEarning[]; Note?: string; Information?: string };

    if (json.Note || json.Information) {
      // Real Alpha Vantage rate-limit/plan message — surface it honestly
      // rather than returning an empty result that looks like "no data".
      return { status: 'rate_limited_or_unavailable', message: json.Note || json.Information, ticker: params.ticker };
    }

    const quarterly = json.quarterlyEarnings ?? [];
    const entry = findQuarter(quarterly, params.fiscalQuarter);

    if (!entry) {
      return {
        status: 'no_data',
        ticker: params.ticker,
        fiscal_quarter: params.fiscalQuarter,
        message: 'No reported/estimated data for this fiscal quarter from Alpha Vantage — it may be a future quarter that has not reported yet, or a fiscal-year offset that does not match the requested calendar quarter.',
      };
    }

    const out: Record<string, unknown> = {
      status: 'success',
      ticker: params.ticker,
      fiscal_quarter: params.fiscalQuarter,
      fiscal_date_ending: entry.fiscalDateEnding,
      source: 'Alpha Vantage EARNINGS (real reported historical estimate/actual)',
    };

    if (params.estimateType === 'eps' || params.estimateType === 'all') {
      out['eps'] = {
        estimated_eps: entry.estimatedEPS ?? null,
        reported_eps: entry.reportedEPS ?? null,
        surprise: entry.surprise ?? null,
        surprise_percentage: entry.surprisePercentage ?? null,
      };
    }
    if (params.estimateType === 'revenue' || params.estimateType === 'all') {
      out['revenue'] = { status: 'unavailable', reason: 'Alpha Vantage\'s free EARNINGS endpoint does not include revenue figures.' };
    }
    if (params.estimateType === 'guidance' || params.estimateType === 'all') {
      out['guidance'] = { status: 'unavailable', reason: 'No free, legitimate forward-guidance data source exists in this account\'s infrastructure.' };
    }

    return out;
  }
}
