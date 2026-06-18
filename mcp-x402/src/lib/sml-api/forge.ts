const FORGE_BASE = process.env['FORGE_GATEWAY_URL'] ?? 'https://forge-gateway-a822.onrender.com';

async function forgeGet(path: string): Promise<unknown> {
  const res = await fetch(`${FORGE_BASE}${path}`, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Forge Gateway GET ${path}: HTTP ${res.status}`);
  return res.json();
}

export interface ForgeLLMParams {
  model: string;
  prompt: string;
  maxTokens?: number;
  walletAddress: string;
}

async function forgePost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${FORGE_BASE}${path}`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Forge Gateway POST ${path}: HTTP ${res.status}`);
  return res.json();
}

export const ForgeGatewayAPI = {
  status: () => forgeGet('/health'),
  llm: (params: ForgeLLMParams) => forgePost('/v1/llm', params),
};
