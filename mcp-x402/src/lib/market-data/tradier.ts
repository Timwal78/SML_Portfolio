// Tradier client for equities bars and options chains WITH real market-derived
// Greeks (OPRA-fed, not modeled). Preferred over Polygon when configured — same
// "Tradier preferred for options" priority the main SqueezeOS app documents —
// because a broker-observed delta beats a Black-Scholes estimate of our own.
// Never returns mock data: a missing token or an upstream error throws.

export type EquityTimeframe = '1h' | '1d';

function tradierBase(): string {
  return process.env['TRADIER_ENV'] === 'production'
    ? 'https://api.tradier.com/v1'
    : 'https://sandbox.tradier.com/v1';
}

async function tradierGet(path: string, params: Record<string, string>, token: string): Promise<unknown> {
  const url = new URL(`${tradierBase()}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '(unreadable body)');
    throw new Error(`Tradier ${path} → HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

// ── Equities ────────────────────────────────────────────────────────────────

/**
 * Fetch up to `lookbackBars` closing prices for `ticker`, oldest first.
 * "1d" pulls Tradier's daily history endpoint; "1h" pulls 15-minute timesales
 * and buckets to one close per hour (Tradier has no native hourly interval).
 */
export async function fetchEquityCloses(
  ticker: string,
  timeframe: EquityTimeframe,
  token: string,
  lookbackBars = 60,
): Promise<number[]> {
  if (!token) throw new Error('Tradier API key is required — set TRADIER_API_KEY');

  const fmtDate = (d: Date): string => d.toISOString().slice(0, 10);

  if (timeframe === '1d') {
    const end = new Date();
    const start = new Date(end.getTime() - lookbackBars * 1.6 * 24 * 3600 * 1000);
    const data = (await tradierGet(
      '/markets/history',
      { symbol: ticker, interval: 'daily', start: fmtDate(start), end: fmtDate(end) },
      token,
    )) as { history?: { day?: { close: number }[] | { close: number } } | string };
    const days = typeof data.history === 'object' ? data.history?.day : undefined;
    const closes = asArray(days).map((d) => d.close).filter((c) => typeof c === 'number');
    return closes.slice(-lookbackBars);
  }

  const end = new Date();
  const start = new Date(end.getTime() - lookbackBars * 3 * 3600 * 1000);
  const fmtDateTime = (d: Date): string => d.toISOString().slice(0, 16).replace('T', ' ');
  const data = (await tradierGet(
    '/markets/timesales',
    { symbol: ticker, interval: '15min', start: fmtDateTime(start), end: fmtDateTime(end) },
    token,
  )) as { series?: { data?: { time: string; close: number }[] | { time: string; close: number } } | string };
  const points = typeof data.series === 'object' ? asArray(data.series?.data) : [];
  const hourly = new Map<string, number>();
  for (const p of points) {
    if (typeof p.close !== 'number' || !p.time) continue;
    hourly.set(p.time.slice(0, 13), p.close); // chronological order → last write = latest close in that hour
  }
  return [...hourly.values()].slice(-lookbackBars);
}

// ── Options ─────────────────────────────────────────────────────────────────

export interface TradierContractSnapshot {
  ticker: string;
  strike: number;
  expirationDate: string;
  contractType: 'call' | 'put';
  /** Real, market-derived delta from Tradier's OPRA-fed greeks — not modeled. Null if Tradier hasn't priced greeks for this contract yet. */
  delta: number | null;
}

export interface TradierChainSnapshot {
  underlying: string;
  underlyingPrice: number;
  contracts: TradierContractSnapshot[];
}

export interface TradierChainQuery {
  expirationDate?: string;
  contractType?: 'call' | 'put';
}

/** Fetch a real options chain with real (not modeled) Greeks for `underlying`. */
export async function fetchOptionsChainWithGreeks(
  underlying: string,
  token: string,
  query: TradierChainQuery = {},
): Promise<TradierChainSnapshot> {
  if (!token) throw new Error('Tradier API key is required — set TRADIER_API_KEY');
  const symbol = underlying.toUpperCase();

  let expiration = query.expirationDate;
  if (!expiration) {
    const expData = (await tradierGet('/markets/options/expirations', { symbol, includeAllRoots: 'true' }, token)) as {
      expirations?: { date?: string[] | string } | string;
    };
    const dates = typeof expData.expirations === 'object' ? asArray(expData.expirations?.date) : [];
    expiration = dates[0];
    if (!expiration) throw new Error(`no_data: no option expirations returned for ${symbol}`);
  }

  const [chainData, quoteData] = await Promise.all([
    tradierGet('/markets/options/chains', { symbol, expiration, greeks: 'true' }, token) as Promise<{
      options?: {
        option?:
          | { symbol: string; strike: number; option_type: 'call' | 'put'; greeks?: { delta?: number } }[]
          | { symbol: string; strike: number; option_type: 'call' | 'put'; greeks?: { delta?: number } };
      } | string;
    }>,
    tradierGet('/markets/quotes', { symbols: symbol, greeks: 'false' }, token) as Promise<{
      quotes?: { quote?: { last?: number } | { last?: number }[] } | string;
    }>,
  ]);

  const rawOptions = typeof chainData.options === 'object' ? chainData.options?.option : undefined;
  const arr = asArray(rawOptions);
  const filtered = query.contractType ? arr.filter((o) => o.option_type === query.contractType) : arr;

  const quote = typeof quoteData.quotes === 'object' ? quoteData.quotes?.quote : undefined;
  const quoteObj = Array.isArray(quote) ? quote[0] : quote;
  const underlyingPrice = quoteObj?.last ?? 0;

  const contracts: TradierContractSnapshot[] = filtered.map((o) => ({
    ticker: o.symbol,
    strike: o.strike,
    expirationDate: expiration as string,
    contractType: o.option_type,
    delta: typeof o.greeks?.delta === 'number' ? o.greeks.delta : null,
  }));

  return { underlying: symbol, underlyingPrice, contracts };
}
