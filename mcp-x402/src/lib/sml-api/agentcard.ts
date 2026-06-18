const AGENTCARD_BASE = process.env['AGENTCARD_URL'] ?? 'https://agentcard.onrender.com';

async function acGet(path: string): Promise<unknown> {
  const res = await fetch(`${AGENTCARD_BASE}${path}`, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`AgentCard GET ${path}: HTTP ${res.status}`);
  return res.json();
}

export interface AgentCardMintParams {
  walletAddress: string;
  name: string;
  did?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentCardVerifyParams {
  walletAddress: string;
  message: string;
  signature: string;
}

async function acPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${AGENTCARD_BASE}${path}`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`AgentCard POST ${path}: HTTP ${res.status}`);
  return res.json();
}

export const AgentCardAPI = {
  lookup: (walletOrDid: string) => acGet(`/v1/card/${encodeURIComponent(walletOrDid)}`),
  verify: (params: AgentCardVerifyParams) => acPost('/v1/verify', params),
  mint: (params: AgentCardMintParams) => acPost('/v1/mint', params),
};
