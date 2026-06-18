const RAILS_BASE = process.env['SML_RAILS_URL'] ?? 'https://sml-rails.onrender.com';

async function railsGet(path: string): Promise<unknown> {
  const res = await fetch(`${RAILS_BASE}${path}`, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`SML Rails GET ${path}: HTTP ${res.status}`);
  return res.json();
}

export interface RailsTransferParams {
  fromAddress: string;
  toAddress: string;
  amount: string;
  currency: 'RLUSD' | 'XRP';
  memo?: string;
}

async function railsPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${RAILS_BASE}${path}`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`SML Rails POST ${path}: HTTP ${res.status}`);
  return res.json();
}

export const RailsAPI = {
  status: () => railsGet('/status'),
  transfer: (params: RailsTransferParams) => railsPost('/transfer', params),
};
