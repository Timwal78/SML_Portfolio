// backtester-mcp microservice client
// Wraps the Python backtest_service.py running at BACKTEST_BASE_URL

const BASE = process.env.BACKTEST_BASE_URL ?? 'http://localhost:8300';

export interface BacktestParams {
  ticker: string;
  lookback_days?: number;
  signals?: number[];
  fees?: number;
  slippage?: number;
  momentum_window?: number;
  momentum_threshold?: number;
}

export interface ValidateParams {
  ticker: string;
  lookback_days?: number;
  train_ratio?: number;
  fees?: number;
  slippage?: number;
}

async function post(path: string, body: object): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json();
}

export const BacktestAPI = {
  health: async (): Promise<unknown> => {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5_000) });
    return res.json();
  },

  backtest: (params: BacktestParams): Promise<unknown> => post('/backtest', params),

  walkForward: (params: ValidateParams): Promise<unknown> => post('/validate', params),
};
