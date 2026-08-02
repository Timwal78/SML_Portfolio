import { createPublicClient, http, getAddress, defineChain } from 'viem';
import { base } from 'viem/chains';

// USDC contract (6 decimals) — Base mainnet only, hardcoded (operator
// directive, 2026-08-01): this verifies real customer payments and must
// never be routed to a testnet under any configuration.
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
// Global Dollar (USDG) on Robinhood Chain — 6 decimals, verified on Blockscout.
// NOT a CDP rail. Discovery + sovereign X-PAYMENT-TX only.
export const USDG_ROBINHOOD = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_CAIP = 'eip155:4663';
// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const robinhoodChain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env['ROBINHOOD_RPC_URL'] ?? 'https://rpc.mainnet.chain.robinhood.com',
      ],
    },
  },
  blockExplorers: {
    default: {
      name: 'Blockscout',
      url: 'https://robinhoodchain.blockscout.com',
    },
  },
});

export interface VerifyParams {
  txHash: string;
  payTo: string;
  minAmountUnits: bigint; // token base units (6 decimals for USDC + USDG)
}

export interface VerifyResult {
  ok: boolean;
  from?: string;
  amountUnits?: bigint;
  error?: string;
  chain?: 'base' | 'robinhood';
  asset?: string;
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
// Release a hold if WE failed to deliver data, so the payer can retry the same tx.
export function releaseRedeem(txHash: string): void {
  redeemed.delete(txHash.toLowerCase());
}

function topicToAddress(topic: string): string {
  // 0x + 64 hex chars → take the trailing 40 (20-byte address)
  return getAddress(('0x' + topic.slice(-40)) as `0x${string}`);
}

async function verifyErc20Transfer(params: {
  txHash: string;
  payTo: string;
  minAmountUnits: bigint;
  asset: string;
  chain: typeof base | typeof robinhoodChain;
  rpcUrl: string;
  chainTag: 'base' | 'robinhood';
  missError: string;
}): Promise<VerifyResult> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(params.txHash)) {
    return { ok: false, error: 'invalid_tx_hash_format' };
  }

  const assetLc = params.asset.toLowerCase();
  const payToLc = params.payTo.toLowerCase();
  const client = createPublicClient({
    chain: params.chain,
    transport: http(params.rpcUrl),
  });

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
    if (log.address.toLowerCase() !== assetLc) continue;
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
    return {
      ok: true,
      from,
      amountUnits: value,
      chain: params.chainTag,
      asset: params.asset,
    };
  }
  return { ok: false, error: params.missError };
}

// Verifies that `txHash` is a confirmed USDC Transfer to `payTo` of at least
// `minAmountUnits`, directly on Base — no facilitator, no custody, read-only.
export async function verifyBaseUsdcPayment(params: VerifyParams): Promise<VerifyResult> {
  const rpcUrl = process.env['BASE_RPC_URL'] ?? 'https://mainnet.base.org';
  return verifyErc20Transfer({
    ...params,
    asset: USDC_BASE,
    chain: base,
    rpcUrl,
    chainTag: 'base',
    missError: 'no_matching_usdc_transfer',
  });
}

// Verifies USDG Transfer on Robinhood Chain (4663). Non-CDP rail.
// Clients pay on-chain and send X-PAYMENT-TX=<txHash>. Same units (6 decimals).
export async function verifyRobinhoodUsdgPayment(params: VerifyParams): Promise<VerifyResult> {
  const rpcUrl =
    process.env['ROBINHOOD_RPC_URL'] ?? 'https://rpc.mainnet.chain.robinhood.com';
  return verifyErc20Transfer({
    ...params,
    asset: USDG_ROBINHOOD,
    chain: robinhoodChain,
    rpcUrl,
    chainTag: 'robinhood',
    missError: 'no_matching_usdg_transfer',
  });
}

/** Try Base USDC first, then Robinhood USDG (same payTo EOA on both chains). */
export async function verifySovereignPayment(params: VerifyParams): Promise<VerifyResult> {
  const baseHit = await verifyBaseUsdcPayment(params);
  if (baseHit.ok) return baseHit;
  const rhHit = await verifyRobinhoodUsdgPayment(params);
  if (rhHit.ok) return rhHit;
  return {
    ok: false,
    error: `sovereign_unverified base=${baseHit.error ?? '?'} robinhood=${rhHit.error ?? '?'}`,
  };
}
