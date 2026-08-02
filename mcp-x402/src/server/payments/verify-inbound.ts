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
  chain?: 'base' | 'robinhood' | 'solana';
  asset?: string;
}

// SPL USDC mint — Solana mainnet (Circle).
export const USDC_SOLANA_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
// CAIP-2 style id used by multi-chain x402 sellers / agent402 (mainnet).
export const SOLANA_CAIP = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
export const SOLANA_PAY_TO_DEFAULT = 'E4d3JwcTjeqTRkkQS4moszcfa4R7G1NMgPSew4KBNFrB';

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

/**
 * Verify SPL USDC transfer to payTo on Solana mainnet via RPC getTransaction.
 * txHash = base58 signature. payTo = Solana base58 owner address (not ATA).
 * Accepts token balance changes on the payTo owner for the USDC mint.
 */
export async function verifySolanaUsdcPayment(params: {
  txHash: string;
  payTo: string;
  minAmountUnits: bigint;
}): Promise<VerifyResult> {
  const sig = params.txHash.trim();
  // Solana sigs are base58, typically 87-88 chars; reject 0x EVM hashes here.
  if (!sig || sig.startsWith('0x') || sig.length < 64 || sig.length > 128) {
    return { ok: false, error: 'invalid_solana_sig_format' };
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(sig)) {
    return { ok: false, error: 'invalid_solana_sig_charset' };
  }
  const payTo = params.payTo.trim();
  if (!payTo || payTo.startsWith('0x')) {
    return { ok: false, error: 'invalid_solana_payTo' };
  }

  const rpc = process.env['SOLANA_RPC_URL'] ?? 'https://api.mainnet-beta.solana.com';
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'getTransaction',
    params: [
      sig,
      {
        encoding: 'jsonParsed',
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      },
    ],
  };

  let tx: any;
  try {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'mcp-x402-sol-verify/1.0' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, error: `solana_rpc_http_${res.status}` };
    const j = (await res.json()) as { result?: any; error?: { message?: string } };
    if (j.error) return { ok: false, error: `solana_rpc_${j.error.message ?? 'error'}` };
    tx = j.result;
  } catch (err) {
    return { ok: false, error: `solana_rpc_fetch_${String(err).slice(0, 80)}` };
  }

  if (!tx) return { ok: false, error: 'solana_tx_not_found_or_pending' };
  if (tx.meta?.err) return { ok: false, error: 'solana_tx_failed' };

  const meta = tx.meta || {};
  const message = tx.transaction?.message || {};
  const accountKeys: string[] = [];
  const keys = message.accountKeys || [];
  for (const k of keys) {
    if (typeof k === 'string') accountKeys.push(k);
    else if (k && typeof k === 'object' && typeof k.pubkey === 'string') accountKeys.push(k.pubkey);
  }

  // Path 1: pre/post token balances (most reliable for SPL transfers)
  const pre: any[] = meta.preTokenBalances || [];
  const post: any[] = meta.postTokenBalances || [];
  // Map accountIndex -> balance info for USDC mint
  type Bal = { owner?: string; amount: bigint; accountIndex: number };
  const toBal = (rows: any[]): Bal[] => {
    const out: Bal[] = [];
    for (const r of rows) {
      if (!r || String(r.mint) !== USDC_SOLANA_MINT) continue;
      const amt = BigInt(r.uiTokenAmount?.amount ?? r.uiTokenAmount?.uiAmountString ?? '0');
      out.push({ owner: r.owner, amount: amt, accountIndex: Number(r.accountIndex) });
    }
    return out;
  };
  const preB = toBal(pre);
  const postB = toBal(post);

  // Find post balance for payTo owner that increased vs pre
  for (const pb of postB) {
    if (pb.owner !== payTo) continue;
    const prev = preB.find((x) => x.owner === payTo && x.accountIndex === pb.accountIndex)
      || preB.find((x) => x.owner === payTo);
    const before = prev ? prev.amount : 0n;
    const delta = pb.amount - before;
    if (delta >= params.minAmountUnits) {
      // try find sender: largest decrease
      let from = '';
      let bestDec = 0n;
      for (const a of preB) {
        if (a.owner === payTo) continue;
        const after = postB.find((x) => x.owner === a.owner && x.accountIndex === a.accountIndex)
          || postB.find((x) => x.owner === a.owner);
        const afterAmt = after ? after.amount : 0n;
        const dec = a.amount - afterAmt;
        if (dec > bestDec) {
          bestDec = dec;
          from = a.owner || '';
        }
      }
      return {
        ok: true,
        from,
        amountUnits: delta,
        chain: 'solana',
        asset: USDC_SOLANA_MINT,
      };
    }
  }

  // Path 2: parsed instructions transfer / transferChecked
  const insGroups: any[] = [];
  if (Array.isArray(message.instructions)) insGroups.push(message.instructions);
  if (Array.isArray(meta.innerInstructions)) {
    for (const inner of meta.innerInstructions) {
      if (Array.isArray(inner.instructions)) insGroups.push(inner.instructions);
    }
  }
  for (const group of insGroups) {
    for (const ix of group) {
      const parsed = ix.parsed;
      if (!parsed || typeof parsed !== 'object') continue;
      const typ = String(parsed.type || '');
      const info = parsed.info || {};
      if (typ !== 'transfer' && typ !== 'transferChecked') continue;
      const mint = info.mint ? String(info.mint) : USDC_SOLANA_MINT;
      if (mint !== USDC_SOLANA_MINT && typ === 'transferChecked') continue;
      // transferChecked has tokenAmount.amount; transfer has amount
      let amount = 0n;
      try {
        if (info.tokenAmount?.amount != null) amount = BigInt(info.tokenAmount.amount);
        else if (info.amount != null) amount = BigInt(info.amount);
      } catch { continue; }
      if (amount < params.minAmountUnits) continue;
      const dest = String(info.destination || '');
      const auth = String(info.authority || info.source || '');
      // destination may be ATA — check post token balances owner mapping
      const destOwner = postB.find((b) => accountKeys[b.accountIndex] === dest)?.owner
        || postB.find((b) => b.owner === payTo)?.owner;
      if (dest === payTo || destOwner === payTo || info.destinationOwner === payTo) {
        return {
          ok: true,
          from: auth,
          amountUnits: amount,
          chain: 'solana',
          asset: USDC_SOLANA_MINT,
        };
      }
      // If destination ATA belongs to payTo via post balances
      for (const pb of postB) {
        if (pb.owner === payTo && accountKeys[pb.accountIndex] === dest && amount >= params.minAmountUnits) {
          return {
            ok: true,
            from: auth,
            amountUnits: amount,
            chain: 'solana',
            asset: USDC_SOLANA_MINT,
          };
        }
      }
    }
  }

  return { ok: false, error: 'no_matching_solana_usdc_transfer' };
}

/** Try Base USDC, Robinhood USDG, then Solana USDC (tx hash / sig in X-PAYMENT-TX). */
export async function verifySovereignPayment(
  params: VerifyParams & { solanaPayTo?: string },
): Promise<VerifyResult> {
  const sig = params.txHash.trim();
  // Fast path: Solana signatures are never 0x-prefixed 32-byte hashes
  if (!sig.startsWith('0x')) {
    const solPayTo = params.solanaPayTo || process.env['SOLANA_PAYMENT_RECEIVER'] || SOLANA_PAY_TO_DEFAULT;
    const solHit = await verifySolanaUsdcPayment({
      txHash: sig,
      payTo: solPayTo,
      minAmountUnits: params.minAmountUnits,
    });
    if (solHit.ok) return solHit;
    // fall through to EVM only if it looks like it could be hex without 0x — still try sol error return mixed
    if (sig.length >= 64 && !/^[0-9a-fA-F]+$/.test(sig)) {
      // clearly base58-ish — don't bother EVM
      return solHit;
    }
  }

  const baseHit = await verifyBaseUsdcPayment(params);
  if (baseHit.ok) return baseHit;
  const rhHit = await verifyRobinhoodUsdgPayment(params);
  if (rhHit.ok) return rhHit;

  // Last resort: solana if 0x was wrong guess? skip
  return {
    ok: false,
    error: `sovereign_unverified base=${baseHit.error ?? '?'} robinhood=${rhHit.error ?? '?'}`,
  };
}
