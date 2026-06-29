import { createPublicClient, http, getAddress } from 'viem';
import { base, baseSepolia } from 'viem/chains';

// USDC contracts (6 decimals)
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export interface VerifyParams {
  txHash: string;
  payTo: string;
  minAmountUnits: bigint; // USDC base units (6 decimals)
}

export interface VerifyResult {
  ok: boolean;
  from?: string;
  amountUnits?: bigint;
  error?: string;
}

// Replay protection. In-memory: resets on redeploy (acceptable for micropayments;
// a worst case lets a single tx be reused only across a deploy boundary).
const redeemed = new Set<string>();
export function alreadyRedeemed(txHash: string): boolean {
  return redeemed.has(txHash.toLowerCase());
}
export function markRedeemed(txHash: string): void {
  redeemed.add(txHash.toLowerCase());
}

function topicToAddress(topic: string): string {
  // 0x + 64 hex chars → take the trailing 40 (20-byte address)
  return getAddress(('0x' + topic.slice(-40)) as `0x${string}`);
}

// Verifies that `txHash` is a confirmed USDC Transfer to `payTo` of at least
// `minAmountUnits`, directly on Base — no facilitator, no custody, read-only.
export async function verifyBaseUsdcPayment(params: VerifyParams): Promise<VerifyResult> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(params.txHash)) {
    return { ok: false, error: 'invalid_tx_hash_format' };
  }

  const testnet = process.env['TESTNET'] === 'true';
  const chain = testnet ? baseSepolia : base;
  const rpcUrl = testnet
    ? (process.env['BASE_SEPOLIA_RPC_URL'] ?? 'https://sepolia.base.org')
    : (process.env['BASE_RPC_URL'] ?? 'https://mainnet.base.org');
  const usdc = (testnet ? USDC_BASE_SEPOLIA : USDC_BASE).toLowerCase();
  const payToLc = params.payTo.toLowerCase();

  const client = createPublicClient({ chain, transport: http(rpcUrl) });

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: params.txHash as `0x${string}` });
  } catch {
    return { ok: false, error: 'tx_not_found_or_pending' };
  }
  if (receipt.status !== 'success') {
    return { ok: false, error: 'tx_reverted' };
  }

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== usdc) continue;
    const topics = log.topics;
    if (topics.length < 3) continue;
    if ((topics[0] ?? '').toLowerCase() !== TRANSFER_TOPIC) continue;
    const toTopic = topics[2];
    if (!toTopic) continue;
    let toAddr: string;
    try { toAddr = topicToAddress(toTopic).toLowerCase(); } catch { continue; }
    if (toAddr !== payToLc) continue;
    let value: bigint;
    try { value = BigInt(log.data); } catch { continue; }
    if (value < params.minAmountUnits) continue;
    let from = '';
    const fromTopic = topics[1];
    if (fromTopic) { try { from = topicToAddress(fromTopic); } catch { /* leave blank */ } }
    return { ok: true, from, amountUnits: value };
  }
  return { ok: false, error: 'no_matching_usdc_transfer' };
}
