const PROOF402_BASE = process.env['PROOF402_SERVER_URL'] ?? 'https://four02proof.onrender.com';

async function proofGet(path: string): Promise<unknown> {
  const res = await fetch(`${PROOF402_BASE}${path}`, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`402Proof GET ${path}: HTTP ${res.status}`);
  return res.json();
}

async function proofPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${PROOF402_BASE}${path}`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`402Proof POST ${path}: HTTP ${res.status}`);
  return res.json();
}

export const Proof402API = {
  invoice: (endpointId: string) => proofGet(`/v1/invoice/${encodeURIComponent(endpointId)}`),
  verify: (txHash: string, endpointId: string) => proofPost('/v1/verify', { tx_hash: txHash, endpoint_id: endpointId }),
  creditScore: (walletAddress: string) => proofGet(`/v1/credit/${encodeURIComponent(walletAddress)}`),
};
