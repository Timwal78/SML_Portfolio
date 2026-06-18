import { createHmac } from 'crypto';

const SQUEEZEOS_BASE = process.env['SQUEEZEOS_BASE_URL'] ?? 'https://squeezeos-api.onrender.com';
const PROOF402_SECRET = process.env['PROOF402_TOKEN_SECRET'] ?? '';

// Endpoint UUIDs — override via env vars if they change
const ENDPOINT_UUIDS: Record<string, string> = {
  council: process.env['SQUEEZEOS_UUID_COUNCIL'] ?? '12a0e7a1-0000-0000-0000-000000000001',
  scan: process.env['SQUEEZEOS_UUID_SCAN'] ?? '160cf28d-0000-0000-0000-000000000002',
  options: process.env['SQUEEZEOS_UUID_OPTIONS'] ?? 'c951a374-0000-0000-0000-000000000003',
  iwm: process.env['SQUEEZEOS_UUID_IWM'] ?? '60f48ce0-0000-0000-0000-000000000004',
  marketplace_read: process.env['SQUEEZEOS_UUID_MARKETPLACE_READ'] ?? 'd1a2b3c4-0000-0000-0000-000000000005',
};

/**
 * Generate a SqueezeOS JWT for a premium endpoint.
 * Format: base64(json).HMAC-SHA256(secret, encoded)
 */
export function generateSqueezeOSToken(endpointKey: string, walletAddress: string): string {
  const eid = ENDPOINT_UUIDS[endpointKey];
  if (!eid) throw new Error(`Unknown SqueezeOS endpoint key: ${endpointKey}`);
  if (!PROOF402_SECRET) throw new Error('PROOF402_TOKEN_SECRET is not set — cannot mint SqueezeOS JWT');

  const payload = {
    eid,
    wlt: walletAddress,
    iid: `mcp-x402-${Date.now()}`,
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
  };

  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', PROOF402_SECRET).update(encoded).digest('hex');
  return `${encoded}.${sig}`;
}

async function squeezeGet(path: string, token?: string): Promise<unknown> {
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (token) headers['X-Payment-Token'] = token;
  const res = await fetch(`${SQUEEZEOS_BASE}${path}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`SqueezeOS GET ${path}: HTTP ${res.status}`);
  return res.json();
}

async function squeezePost(path: string, body: unknown, token?: string): Promise<unknown> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };
  if (token) headers['X-Payment-Token'] = token;
  const res = await fetch(`${SQUEEZEOS_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`SqueezeOS POST ${path}: HTTP ${res.status}`);
  return res.json();
}

export const SqueezeOSAPI = {
  // FREE
  preview: (symbol: string) => squeezeGet(`/api/preview/${encodeURIComponent(symbol)}`),
  history: (symbol?: string) => squeezeGet(symbol ? `/api/history/${encodeURIComponent(symbol)}` : '/api/history'),
  oracle: (symbol?: string) => squeezeGet(symbol ? `/api/oracle/${encodeURIComponent(symbol)}` : '/api/oracle'),
  ftd: () => squeezeGet('/api/ftd'),
  status: () => squeezeGet('/api/status'),
  demo: () => squeezeGet('/api/demo'),
  marketplaceBrowse: () => squeezeGet('/api/marketplace'),
  futuresLeaderboard: () => squeezeGet('/api/futures/leaderboard'),

  // PAID — caller must supply walletAddress so we can mint the token
  council: (symbol: string, walletAddress: string) => {
    const token = generateSqueezeOSToken('council', walletAddress);
    return squeezePost('/api/council', { symbol }, token);
  },
  scan: (walletAddress: string) => {
    const token = generateSqueezeOSToken('scan', walletAddress);
    return squeezeGet('/api/scan', token);
  },
  options: (walletAddress: string) => {
    const token = generateSqueezeOSToken('options', walletAddress);
    return squeezeGet('/api/options', token);
  },
  iwm: (walletAddress: string) => {
    const token = generateSqueezeOSToken('iwm', walletAddress);
    return squeezeGet('/api/iwm', token);
  },
  marketplaceRead: (listingId: string, walletAddress: string) => {
    const token = generateSqueezeOSToken('marketplace_read', walletAddress);
    return squeezePost('/api/marketplace/read', { listing_id: listingId }, token);
  },
};
