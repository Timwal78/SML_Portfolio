import { createPublicClient, createWalletClient, http, verifyTypedData } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { mnemonicToSeedSync } from 'bip39';
import HDKey from 'hdkey';
import { generateJwt } from '@coinbase/cdp-sdk/auth';
import { HTTPFacilitatorClient } from '@x402/core/http';
import type { FacilitatorConfig as X402FacilitatorConfig } from '@x402/core/http';
import { VerifyError, SettleError } from '@x402/core/types';
import type {
  PaymentPayload as X402PaymentPayload,
  PaymentRequirements as X402PaymentRequirements,
} from '@x402/core/types';
import { createFacilitatorConfig } from '@coinbase/x402';
import { WalletManager } from './wallet.js';
import { AuditLogger } from '../security/audit.js';
import { X402Stats } from '../security/x402-stats.js';

// ─────────────────────────────────────────────────────────────────────────────
// x402 standard "exact" (EIP-3009) payment types.
// A facilitator verifies a signed transferWithAuthorization and settles it
// on-chain. This layer is brand-agnostic: the SAME interface is implemented by
// our self-hosted settler AND by any external facilitator (x402.org, Coinbase
// CDP, Thirdweb, or a partner's). Chains of facilitators give hybrid fallback.
// ─────────────────────────────────────────────────────────────────────────────

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

export interface Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}
export interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: { signature: string; authorization: Authorization };
}
export interface PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra?: { name?: string; version?: string };
}
export interface VerifyResult { isValid: boolean; invalidReason?: string; payer?: string }
export interface SettleResult { success: boolean; errorReason?: string; transaction?: string; payer?: string }

export interface Facilitator {
  readonly name: string;
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResult>;
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResult>;
}

function isTestnet(): boolean { return process.env['TESTNET'] === 'true'; }
function rpcUrl(): string {
  return isTestnet()
    ? (process.env['BASE_SEPOLIA_RPC_URL'] ?? 'https://sepolia.base.org')
    : (process.env['BASE_RPC_URL'] ?? 'https://mainnet.base.org');
}
export function usdcAddress(): string { return isTestnet() ? USDC_BASE_SEPOLIA : USDC_BASE; }
function chainId(): number { return isTestnet() ? baseSepolia.id : base.id; }

// ── Self-hosted facilitator: verify EIP-712 locally, settle via our own wallet ─
const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

const TRANSFER_WITH_AUTH_ABI = [{
  name: 'transferWithAuthorization',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'v', type: 'uint8' },
    { name: 'r', type: 'bytes32' },
    { name: 's', type: 'bytes32' },
  ],
  outputs: [],
}] as const;

const TOKEN_META_ABI = [
  { name: 'name', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'version', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const;

let cachedDomain: { name: string; version: string } | null = null;
async function tokenDomain(req: PaymentRequirements): Promise<{ name: string; version: string }> {
  if (req.extra?.name && req.extra?.version) return { name: req.extra.name, version: req.extra.version };
  if (cachedDomain) return cachedDomain;
  const client = createPublicClient({ chain: isTestnet() ? baseSepolia : base, transport: http(rpcUrl()) });
  try {
    const [name, version] = await Promise.all([
      (client as any).readContract({ address: usdcAddress() as `0x${string}`, abi: TOKEN_META_ABI, functionName: 'name' }),
      (client as any).readContract({ address: usdcAddress() as `0x${string}`, abi: TOKEN_META_ABI, functionName: 'version' }),
    ]);
    cachedDomain = { name: String(name), version: String(version) };
  } catch {
    cachedDomain = { name: 'USD Coin', version: '2' };
  }
  return cachedDomain;
}

function splitSig(sig: string): { v: number; r: `0x${string}`; s: `0x${string}` } {
  const h = sig.startsWith('0x') ? sig.slice(2) : sig;
  const r = `0x${h.slice(0, 64)}` as `0x${string}`;
  const s = `0x${h.slice(64, 128)}` as `0x${string}`;
  let v = parseInt(h.slice(128, 130), 16);
  if (v < 27) v += 27;
  return { v, r, s };
}

export class SelfFacilitator implements Facilitator {
  readonly name = 'self';

  async verify(payload: PaymentPayload, req: PaymentRequirements): Promise<VerifyResult> {
    try {
      const a = payload.payload.authorization;
      const now = Math.floor(Date.now() / 1000);
      if (a.to.toLowerCase() !== req.payTo.toLowerCase()) return { isValid: false, invalidReason: 'payTo_mismatch' };
      if (BigInt(a.value) < BigInt(req.maxAmountRequired)) return { isValid: false, invalidReason: 'amount_too_low' };
      if (Number(a.validAfter) > now) return { isValid: false, invalidReason: 'not_yet_valid' };
      if (Number(a.validBefore) < now) return { isValid: false, invalidReason: 'expired' };
      const domain = await tokenDomain(req);
      const ok = await verifyTypedData({
        address: a.from as `0x${string}`,
        domain: { name: domain.name, version: domain.version, chainId: chainId(), verifyingContract: usdcAddress() as `0x${string}` },
        types: EIP3009_TYPES,
        primaryType: 'TransferWithAuthorization',
        message: { from: a.from as `0x${string}`, to: a.to as `0x${string}`, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce as `0x${string}` },
        signature: payload.payload.signature as `0x${string}`,
      });
      return ok ? { isValid: true, payer: a.from } : { isValid: false, invalidReason: 'bad_signature' };
    } catch (err) {
      return { isValid: false, invalidReason: `verify_error:${String(err).slice(0, 60)}` };
    }
  }

  async settle(payload: PaymentPayload, req: PaymentRequirements): Promise<SettleResult> {
    try {
      const a = payload.payload.authorization;
      const mnemonic = await WalletManager.getInstance().getSeed();
      const seed = mnemonicToSeedSync(mnemonic);
      const child = HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0");
      if (!child.privateKey) return { success: false, errorReason: 'key_derivation_failed' };
      const account = privateKeyToAccount(`0x${child.privateKey.toString('hex')}`);
      const chain = isTestnet() ? baseSepolia : base;
      const wallet = createWalletClient({ account, chain, transport: http(rpcUrl()) });
      const pub = createPublicClient({ chain, transport: http(rpcUrl()) });
      const { v, r, s } = splitSig(payload.payload.signature);
      const hash = await wallet.writeContract({
        address: usdcAddress() as `0x${string}`,
        abi: TRANSFER_WITH_AUTH_ABI,
        functionName: 'transferWithAuthorization',
        args: [a.from as `0x${string}`, a.to as `0x${string}`, BigInt(a.value), BigInt(a.validAfter), BigInt(a.validBefore), a.nonce as `0x${string}`, v, r, s],
        account, chain,
      });
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') return { success: false, errorReason: 'settle_reverted', transaction: hash };
      return { success: true, transaction: hash, payer: a.from };
    } catch (err) {
      return { success: false, errorReason: `settle_error:${String(err).slice(0, 80)}` };
    }
  }
}

// ── Generic HTTP facilitator: works with ANY x402-compliant facilitator ───────
// x402.org (Coinbase-operated, open), Coinbase CDP (auth), Thirdweb, partner orgs.
//
// This used to hand-build the /verify and /settle HTTP requests ourselves —
// after two rounds of guessing wrong about the wire format (a CAIP-2 network
// id, then a hardcoded x402Version) while a real payment kept failing with an
// unexplained "invalid network: <empty>" from CDP, we stopped guessing and
// switched to delegating to `HTTPFacilitatorClient` from `@x402/core` — the
// same package @coinbase/x402's createFacilitatorConfig() is built against.
// It constructs the exact request Coinbase's own client sends — no more
// hand-rolled request bodies to get subtly wrong.
// x402 has two wire versions that disagree on network format — confirmed
// directly from @x402/core's own schema definitions (schemas/index.d.ts):
//   V1 (NetworkSchemaV1): loose, any non-empty string ("base" works fine)
//   V2 (NetworkSchemaV2): strict CAIP-2, e.g. "eip155:8453" — "base" fails
// Our client (x402-fetch, built on the older v1-era package) sends
// x402Version: 2 but still uses the plain v1-style network name "base".
// CDP's facilitator enforces the strict V2 schema, so that combination is
// invalid on their end — the empty "invalid network: " we kept seeing wasn't
// a missing/blank field, it was a value that failed CAIP-2 format validation.
// x402.org's own error ("No facilitator registered for network: base")
// proves IT parses "base" as a valid network name fine — this conversion is
// CDP-specific, not applied to other facilitators.
const CAIP2_BY_NETWORK: Record<string, string> = {
  base: 'eip155:8453',
  'base-sepolia': 'eip155:84532',
};

function toCaip2Network(network: string): string {
  return CAIP2_BY_NETWORK[network] ?? network;
}

// The real v2 PaymentPayload shape (@x402/core's own x402Client-CdmxbRFj.d.ts)
// is NOT the flat {x402Version, scheme, network, payload} our client sends —
// scheme/network don't even exist at the top level in v2. They live inside a
// required `accepted: PaymentRequirements` field:
//   type PaymentPayload = { x402Version, resource?, accepted: PaymentRequirements, payload, extensions? }
// x402-fetch (built on the older v1-era package) sends the flat v1-style
// shape while labeling it x402Version: 2, which is why CDP's error was
// "must match one of [x402V2PaymentPayload, x402V1PaymentPayload].
// x402V2PaymentPayload requires 'accepted'" — not a network problem at all
// by this point, a whole different top-level structure. Reshape into the
// real v2 form specifically for CDP; x402.org accepts the flat shape as-is.
//
// x402Version is hardcoded to 2 here regardless of what the CLIENT declared.
// A real client sent x402Version: 1 (the older flat-schema label) while this
// function had already moved `network` off the top level and into `accepted`
// — CDP's parser saw x402Version: 1, validated against the V1 (flat) schema,
// found no top-level network field, and returned "invalid network: " (empty).
// The reshaped body is unconditionally V2-shaped, so the declared version
// must always say so too, independent of whatever the inbound payload claimed.
function toCdpV2Payload(payload: PaymentPayload, requirements: X402PaymentRequirements): X402PaymentPayload {
  return {
    x402Version: 2,
    accepted: requirements,
    payload: payload.payload,
  } as unknown as X402PaymentPayload;
}

// @x402/core's HTTPFacilitatorClient truncates any non-x402-shaped error body
// to 200 chars via its own internal responseExcerpt() helper — confirmed by
// reading node_modules/@x402/core/dist/cjs/http/index.js directly — before it
// ever reaches our code. Widening our OWN error-string slicing (a prior fix)
// was a no-op because the text was already cut upstream. rawDiagnosticFetch
// is an optional escape hatch: on a generic (non-VerifyError/SettleError)
// failure, repeat the exact same request ourselves with no truncation, so
// the real error text is visible without another live test round-trip.
type RawDiagnosticFetch = (path: 'verify' | 'settle', payload: X402PaymentPayload, requirements: X402PaymentRequirements) => Promise<string>;

class RemoteFacilitator implements Facilitator {
  readonly name: string;
  private readonly client: HTTPFacilitatorClient;
  private readonly useCaip2Network: boolean;
  private readonly rawDiagnosticFetch?: RawDiagnosticFetch;

  constructor(name: string, config: X402FacilitatorConfig, opts?: { useCaip2Network?: boolean; rawDiagnosticFetch?: RawDiagnosticFetch }) {
    this.name = name;
    this.client = new HTTPFacilitatorClient(config);
    this.useCaip2Network = opts?.useCaip2Network ?? false;
    this.rawDiagnosticFetch = opts?.rawDiagnosticFetch;
  }

  private normalize(payload: PaymentPayload, requirements: PaymentRequirements): [X402PaymentPayload, X402PaymentRequirements] {
    if (!this.useCaip2Network) {
      return [payload as unknown as X402PaymentPayload, requirements as unknown as X402PaymentRequirements];
    }
    const r = { ...requirements, network: toCaip2Network(requirements.network) } as unknown as X402PaymentRequirements;
    return [toCdpV2Payload(payload, r), r];
  }

  private async diagnose(stage: 'verify' | 'settle', p: X402PaymentPayload, r: X402PaymentRequirements, fallback: string): Promise<string> {
    if (!this.rawDiagnosticFetch) return fallback;
    try {
      return await this.rawDiagnosticFetch(stage, p, r);
    } catch {
      return fallback;
    }
  }

  async verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResult> {
    try {
      const [p, r] = this.normalize(payload, requirements);
      const res = await this.client.verify(p, r);
      return { isValid: res.isValid, ...(res.invalidReason ? { invalidReason: res.invalidReason } : {}), ...(res.payer ? { payer: res.payer } : {}) };
    } catch (err) {
      if (err instanceof VerifyError) {
        return { isValid: false, invalidReason: `${this.name}_http_${err.statusCode}:${err.invalidReason ?? ''} ${err.invalidMessage ?? err.message}`.trim() };
      }
      const [p, r] = this.normalize(payload, requirements);
      const full = await this.diagnose('verify', p, r, String(err));
      return { isValid: false, invalidReason: `${this.name}_error:${full.slice(0, 1000)}` };
    }
  }

  async settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResult> {
    try {
      const [p, r] = this.normalize(payload, requirements);
      const res = await this.client.settle(p, r);
      return { success: res.success, ...(res.errorReason ? { errorReason: res.errorReason } : {}), ...(res.transaction ? { transaction: res.transaction } : {}), ...(res.payer ? { payer: res.payer } : {}) };
    } catch (err) {
      if (err instanceof SettleError) {
        return { success: false, errorReason: `${this.name}_http_${err.statusCode}:${err.errorReason ?? ''} ${err.errorMessage ?? err.message}`.trim() };
      }
      const [p, r] = this.normalize(payload, requirements);
      const full = await this.diagnose('settle', p, r, String(err));
      return { success: false, errorReason: `${this.name}_error:${full.slice(0, 1000)}` };
    }
  }
}

export function makeHttpFacilitator(baseUrl: string, opts?: { name?: string; authHeader?: string }): Facilitator {
  const name = opts?.name ?? baseUrl;
  const authHeader = opts?.authHeader;
  return new RemoteFacilitator(name, {
    url: baseUrl.replace(/\/$/, '') as `${string}://${string}`,
    ...(authHeader ? {
      createAuthHeaders: async () => ({
        verify: { Authorization: authHeader },
        settle: { Authorization: authHeader },
        supported: { Authorization: authHeader },
      }),
    } : {}),
  });
}

// ── Coinbase Developer Platform facilitator ────────────────────────────────────
// The managed x402 facilitator at api.cdp.coinbase.com. Distinct from the open,
// no-account x402.org facilitator: CDP only catalogs a route in the x402 Bazaar
// (see index.ts buildBazaarExtensions/discoverable) the first time a real
// payment for it settles specifically through THIS facilitator.
//
// createFacilitatorConfig is Coinbase's own official helper (@coinbase/x402) —
// it builds the same short-lived per-request EdDSA JWT auth (via
// @coinbase/cdp-sdk under the hood) that CDP's real client uses internally.
const CDP_HOST = 'api.cdp.coinbase.com';
const CDP_PATHS: Record<'verify' | 'settle', string> = {
  verify: '/platform/v2/x402/verify',
  settle: '/platform/v2/x402/settle',
};

function makeCdpRawDiagnosticFetch(apiKeyId: string, apiKeySecret: string): RawDiagnosticFetch {
  return async (stage, payload, requirements) => {
    const path = CDP_PATHS[stage];
    const jwt = await generateJwt({ apiKeyId, apiKeySecret, requestMethod: 'POST', requestHost: CDP_HOST, requestPath: path });
    const r = await fetch(`https://${CDP_HOST}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ x402Version: payload.x402Version, paymentPayload: payload, paymentRequirements: requirements }),
    });
    return `HTTP ${r.status}: ${await r.text()}`;
  };
}

export function makeCdpFacilitator(apiKeyId: string, apiKeySecret: string): Facilitator {
  return new RemoteFacilitator('cdp', createFacilitatorConfig(apiKeyId, apiKeySecret), {
    useCaip2Network: true,
    rawDiagnosticFetch: makeCdpRawDiagnosticFetch(apiKeyId, apiKeySecret),
  });
}

// ── Hybrid chain: try facilitators in order until one verifies AND settles ────
export class FacilitatorChain {
  constructor(private readonly chain: Facilitator[]) {}
  get names(): string[] { return this.chain.map((f) => f.name); }

  // Every attempt's reason used to be overwritten by the next one, so the
  // final error only ever showed the LAST facilitator tried — hiding, e.g.,
  // whether CDP was even attempted before falling through to x402.org. Now
  // every attempt is recorded and returned as `attempts` alongside the final
  // errorReason, so a failure is diagnosable from the API response itself,
  // without needing to read Render's raw logs.
  async process(payload: PaymentPayload, req: PaymentRequirements): Promise<SettleResult & { facilitator?: string; attempts?: Array<{ facilitator: string; stage: string; reason: string }> }> {
    const audit = AuditLogger.getInstance();
    const stats = X402Stats.getInstance();
    stats.recordAttempt(req.resource);
    const attempts: Array<{ facilitator: string; stage: string; reason: string }> = [];
    let lastReason = 'no_facilitator';
    for (const f of this.chain) {
      const v = await f.verify(payload, req);
      if (!v.isValid) {
        lastReason = v.invalidReason ?? 'verify_failed';
        attempts.push({ facilitator: f.name, stage: 'verify', reason: lastReason });
        audit.warn('facilitator_verify_failed', { facilitator: f.name, reason: lastReason });
        stats.recordFailed('verify', f.name, lastReason, req.resource);
        continue;
      }
      const s = await f.settle(payload, req);
      if (s.success) {
        audit.info('facilitator_settled', { facilitator: f.name, tx: s.transaction ?? '' });
        stats.recordSettled(f.name, s.payer ?? 'unknown', s.transaction ?? '', req.resource);
        return { ...s, facilitator: f.name, attempts };
      }
      lastReason = s.errorReason ?? 'settle_failed';
      attempts.push({ facilitator: f.name, stage: 'settle', reason: lastReason });
      audit.warn('facilitator_settle_failed', { facilitator: f.name, reason: lastReason });
      stats.recordFailed('settle', f.name, lastReason, req.resource);
    }
    return { success: false, errorReason: lastReason, attempts };
  }
}

// ── Build the chain from env (hybrid-ready) ──────────────────────────────────
// X402_FACILITATOR_CHAIN: comma list of "self" | "<https url>" tried in order.
//   default: "https://x402.org/facilitator" (Coinbase-operated, gasless, open).
// X402_FACILITATOR_AUTH: bearer token applied to HTTP facilitators that need it.
// Examples:
//   "https://x402.org/facilitator"            → public Coinbase facilitator only
//   "https://x402.org/facilitator,self"       → public first, our wallet as fallback
//   "self"                                     → fully sovereign (needs gas on our wallet)
//
// CDP_API_KEY_ID / CDP_API_KEY_SECRET: if BOTH are set, a CdpFacilitator is
// always prepended to the front of the chain — tried first, before whatever
// X402_FACILITATOR_CHAIN specifies. Settling through it is what gets this
// server's routes cataloged in the x402 Bazaar. If CDP is unreachable or a
// call fails for any reason, the chain falls through to the next facilitator
// exactly as it already does today — CDP is additive, not a replacement, so
// this can't make payments less reliable than they already were.
let cachedChain: FacilitatorChain | null = null;
export function facilitatorChain(): FacilitatorChain {
  if (cachedChain) return cachedChain;
  const spec = (process.env['X402_FACILITATOR_CHAIN'] ?? 'https://x402.org/facilitator').split(',').map((s) => s.trim()).filter(Boolean);
  const auth = process.env['X402_FACILITATOR_AUTH'];
  const built: Facilitator[] = spec.map((entry) => {
    if (entry === 'self') return new SelfFacilitator();
    return makeHttpFacilitator(entry, { name: new URL(entry).host, ...(auth ? { authHeader: auth.startsWith('Bearer ') ? auth : `Bearer ${auth}` } : {}) });
  });
  if (built.length === 0) built.push(new SelfFacilitator());

  const cdpKeyId = process.env['CDP_API_KEY_ID'];
  const cdpKeySecret = process.env['CDP_API_KEY_SECRET'];
  if (cdpKeyId && cdpKeySecret) built.unshift(makeCdpFacilitator(cdpKeyId, cdpKeySecret));

  cachedChain = new FacilitatorChain(built);
  return cachedChain;
}

// Decode the standard x402 `X-PAYMENT` header (base64 JSON) into a payload.
export function decodePaymentHeader(headerValue: string): PaymentPayload | null {
  try {
    const json = Buffer.from(headerValue, 'base64').toString('utf8');
    const p = JSON.parse(json) as PaymentPayload;
    if (!p?.payload?.authorization || !p?.payload?.signature) return null;
    return p;
  } catch {
    return null;
  }
}
