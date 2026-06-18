const LAUNCHPAD_BASE = process.env['SML_LAUNCHPAD_URL'] ?? 'https://sml-launchpad.onrender.com';

async function lpGet(path: string): Promise<unknown> {
  const res = await fetch(`${LAUNCHPAD_BASE}${path}`, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Launchpad GET ${path}: HTTP ${res.status}`);
  return res.json();
}

export interface LaunchpadCreateParams {
  name: string;
  symbol: string;
  description: string;
  creatorAddress: string;
  initialSupply: number;
  targetLiquidityXrp: number;
}

export interface LaunchpadBuyParams {
  tokenAddress: string;
  buyerAddress: string;
  xrpAmount: number;
}

async function lpPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${LAUNCHPAD_BASE}${path}`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Launchpad POST ${path}: HTTP ${res.status}`);
  return res.json();
}

export const LaunchpadAPI = {
  status: () => lpGet('/status'),
  list: () => lpGet('/tokens'),
  create: (params: LaunchpadCreateParams) => lpPost('/tokens', params),
  buy: (params: LaunchpadBuyParams) => lpPost('/tokens/buy', params),
};
