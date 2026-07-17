const COPYTRADER_BASE = process.env['SML_COPYTRADER_URL'] ?? 'https://sml-copytrader.onrender.com';

async function ctGet(path: string): Promise<unknown> {
  const res = await fetch(`${COPYTRADER_BASE}${path}`, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`CopyTrader GET ${path}: HTTP ${res.status}`);
  return res.json();
}

export interface CopyTraderSubscribeParams {
  whaleAddress: string;
  subscriberAddress: string;
  maxCopyAmountXrp: number;
}

async function ctPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${COPYTRADER_BASE}${path}`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`CopyTrader POST ${path}: HTTP ${res.status}`);
  return res.json();
}

export const CopyTraderAPI = {
  status: () => ctGet('/status'),
  whales: () => ctGet('/whales'),
  subscribe: (params: CopyTraderSubscribeParams) => ctPost('/subscribe', params),
};
