const GHOST_BASE = process.env['GHOST_LAYER_URL'] ?? 'https://ghost-layer.onrender.com';

async function ghostGet(path: string): Promise<unknown> {
  const res = await fetch(`${GHOST_BASE}${path}`, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Ghost Layer GET ${path}: HTTP ${res.status}`);
  return res.json();
}

export interface GhostRouteParams {
  fromChain: 'xrpl' | 'base';
  toChain: 'xrpl' | 'base';
  amount: string;
  currency: string;
  destinationAddress: string;
  walletAddress: string;
}

async function ghostPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${GHOST_BASE}${path}`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Ghost Layer POST ${path}: HTTP ${res.status}`);
  return res.json();
}

export const GhostLayerAPI = {
  status: () => ghostGet('/api/status'),
  route: (params: GhostRouteParams) => ghostPost('/api/route', params),
};
