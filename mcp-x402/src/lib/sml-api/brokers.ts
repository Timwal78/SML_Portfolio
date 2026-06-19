// Broker execution rails — Robinhood + Tradier
// Robinhood: OAuth2 Bearer token (ROBINHOOD_ACCESS_TOKEN env)
// Tradier:   Bearer token (TRADIER_API_KEY env, TRADIER_ENV=sandbox|production)

const TRADIER_BASE = process.env.TRADIER_ENV === 'production'
  ? 'https://api.tradier.com/v1'
  : 'https://sandbox.tradier.com/v1';

const ROBINHOOD_BASE = 'https://api.robinhood.com';

// ── Shared fetch helpers ────────────────────────────────────────────────────

async function tradierGet(path: string, params?: Record<string, string>): Promise<unknown> {
  const token = process.env.TRADIER_API_KEY;
  if (!token) throw new Error('TRADIER_API_KEY not configured');
  const url = new URL(`${TRADIER_BASE}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Tradier ${res.status}: ${res.statusText}`);
  return res.json();
}

async function tradierPost(path: string, body: Record<string, string>): Promise<unknown> {
  const token = process.env.TRADIER_API_KEY;
  if (!token) throw new Error('TRADIER_API_KEY not configured');
  const res = await fetch(`${TRADIER_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Tradier ${res.status}: ${res.statusText}`);
  return res.json();
}

async function robinhoodGet(path: string): Promise<unknown> {
  const token = process.env.ROBINHOOD_ACCESS_TOKEN;
  if (!token) throw new Error('ROBINHOOD_ACCESS_TOKEN not configured');
  const res = await fetch(`${ROBINHOOD_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Robinhood ${res.status}: ${res.statusText}`);
  return res.json();
}

async function robinhoodPost(path: string, body: object): Promise<unknown> {
  const token = process.env.ROBINHOOD_ACCESS_TOKEN;
  if (!token) throw new Error('ROBINHOOD_ACCESS_TOKEN not configured');
  const res = await fetch(`${ROBINHOOD_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Robinhood ${res.status}: ${res.statusText}`);
  return res.json();
}

// ── Tradier API ─────────────────────────────────────────────────────────────

export interface TradierQuoteParams { symbols: string }
export interface TradierOrderParams {
  account_id: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  duration: 'day' | 'gtc' | 'pre' | 'post';
  price?: number;
  stop?: number;
}

export const TradierAPI = {
  quote: (params: TradierQuoteParams) =>
    tradierGet('/markets/quotes', { symbols: params.symbols, greeks: 'false' }),

  optionChain: (symbol: string, expiration: string) =>
    tradierGet('/markets/options/chains', { symbol, expiration, greeks: 'true' }),

  order: (params: TradierOrderParams) => {
    const body: Record<string, string> = {
      class: 'equity',
      symbol: params.symbol,
      side: params.side,
      quantity: String(params.quantity),
      type: params.type,
      duration: params.duration,
    };
    if (params.price !== undefined) body.price = String(params.price);
    if (params.stop !== undefined) body.stop = String(params.stop);
    return tradierPost(`/accounts/${params.account_id}/orders`, body);
  },

  positions: (account_id: string) =>
    tradierGet(`/accounts/${account_id}/positions`),

  balances: (account_id: string) =>
    tradierGet(`/accounts/${account_id}/balances`),

  orderStatus: (account_id: string, order_id: string) =>
    tradierGet(`/accounts/${account_id}/orders/${order_id}`),
};

// ── Robinhood API ────────────────────────────────────────────────────────────

export interface RobinhoodOrderParams {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  type: 'market' | 'limit';
  time_in_force: 'gfd' | 'gtc' | 'ioc' | 'opg';
  price?: number;
}

export const RobinhoodAPI = {
  quote: async (symbol: string) => {
    const data = await robinhoodGet(`/quotes/?symbols=${symbol}`) as { results?: unknown[] };
    return data.results?.[0] ?? data;
  },

  instruments: async (symbol: string) => {
    const data = await robinhoodGet(`/instruments/?symbol=${symbol}`) as { results?: { url: string }[] };
    return data.results?.[0];
  },

  order: async (params: RobinhoodOrderParams) => {
    const instrument = await RobinhoodAPI.instruments(params.symbol) as { url?: string } | undefined;
    if (!instrument?.url) throw new Error(`Instrument not found: ${params.symbol}`);
    const body: Record<string, unknown> = {
      account: `/accounts/${process.env.ROBINHOOD_ACCOUNT_ID}/`,
      instrument: instrument.url,
      symbol: params.symbol,
      side: params.side,
      quantity: params.quantity,
      type: params.type,
      time_in_force: params.time_in_force,
      trigger: 'immediate',
    };
    if (params.price !== undefined) body.price = String(params.price);
    return robinhoodPost('/orders/', body);
  },

  portfolio: () => robinhoodGet('/portfolios/'),

  positions: () => robinhoodGet('/positions/?nonzero=true'),

  orderHistory: () => robinhoodGet('/orders/?page_size=20'),
};
