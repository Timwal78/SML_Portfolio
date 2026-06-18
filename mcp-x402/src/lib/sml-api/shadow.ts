const SHADOW_BASE = process.env['SHADOW_DESK_URL'] ?? 'https://shadow-desk.onrender.com';
const SHADOW_ADMIN_KEY = process.env['SHADOW_ADMIN_API_KEY'] ?? '';

async function shadowPost(path: string, body: unknown): Promise<unknown> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };
  if (SHADOW_ADMIN_KEY) headers['X-Admin-Key'] = SHADOW_ADMIN_KEY;
  const res = await fetch(`${SHADOW_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Shadow Desk POST ${path}: HTTP ${res.status}`);
  return res.json();
}

export interface ShadowQueryParams {
  query: string;
  context?: string;
  walletAddress: string;
}

export interface ShadowIngestParams {
  source: string;
  payload: unknown;
  walletAddress: string;
}

export const ShadowDeskAPI = {
  query: (params: ShadowQueryParams) => shadowPost('/query', params),
  ingest: (params: ShadowIngestParams) => shadowPost('/ingest', params),
};
