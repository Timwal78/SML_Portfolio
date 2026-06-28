/**
 * Agent-payment enforcement gate — the REAL x402 model.
 *
 * Today the gateway "pays itself" (gateway wallet -> SML receiver) and serves paid
 * tools regardless, so they're effectively free. This gate flips that to the correct
 * flow: tool call -> 402 challenge (invoice) -> agent pays from ITS wallet -> agent
 * re-calls with tx_hash -> we VERIFY via 402Proof -> serve.
 *
 * Safety: OFF by default (ENFORCE_AGENT_PAYMENT). When off, nothing here runs and
 * existing behavior is unchanged. When on, each paid tool needs its 402Proof endpoint
 * UUID (PROOF402_ENDPOINT_<TOOL>); without it the gate fails CLOSED (never serves free).
 *
 * NOTE: isVerified() interprets the 402Proof /v1/verify response defensively. Confirm
 * the exact success contract against the live 402Proof service before going live.
 */

import { Proof402API } from '../../lib/sml-api/proof402.js';
import { getPaymentReceiver } from './x402.js';

export function isAgentPaymentEnforced(): boolean {
  return (process.env['ENFORCE_AGENT_PAYMENT'] ?? '').toLowerCase() === 'true';
}

/** Resolve a tool's 402Proof endpoint UUID. Real values come from env. */
export function resolveEndpointId(toolName: string): string | undefined {
  const fromEnv = process.env[`PROOF402_ENDPOINT_${toolName.toUpperCase()}`];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return ENDPOINT_MAP[toolName];
}

/** Built-in endpoint UUIDs. EMPTY by default — fill via env or here once registered. */
const ENDPOINT_MAP: Record<string, string> = {
  // squeezeos_council: '<real-402proof-endpoint-uuid>',
};

/** Defensive success check for the 402Proof /v1/verify response. */
export function isVerified(resp: unknown): boolean {
  if (resp === null || typeof resp !== 'object') return false;
  const r = resp as Record<string, unknown>;
  if (r['error']) return false;
  if (r['verified'] === true || r['valid'] === true || r['ok'] === true) return true;
  const status = typeof r['status'] === 'string' ? (r['status'] as string).toLowerCase() : '';
  return status === 'confirmed' || status === 'verified' || status === 'paid';
}

export interface PaymentProof {
  txHash: string;
}

export type GateResult =
  | { status: 'paid'; txHash: string; detail: unknown }
  | { status: 'payment_required'; endpointId: string; payTo: string; amount: string; invoice?: unknown; instructions: string }
  | { status: 'payment_invalid'; endpointId: string; detail: unknown }
  | { status: 'unconfigured'; toolName: string };

/**
 * Enforce agent payment for a tool call. Returns a discriminated result; the caller
 * (executeX402Payment) translates it into a served response, a 402 challenge, or a
 * rejection. Never serves on anything but {status:'paid'}.
 */
export async function enforceAgentPayment(params: {
  toolName: string;
  price: string;
  paymentProof?: PaymentProof;
}): Promise<GateResult> {
  const endpointId = resolveEndpointId(params.toolName);
  if (!endpointId) {
    return { status: 'unconfigured', toolName: params.toolName };
  }

  // No proof yet -> issue a 402 challenge (invoice is best-effort).
  if (!params.paymentProof?.txHash) {
    let invoice: unknown;
    try {
      invoice = await Proof402API.invoice(endpointId);
    } catch {
      invoice = undefined;
    }
    return {
      status: 'payment_required',
      endpointId,
      payTo: getPaymentReceiver(),
      amount: params.price,
      invoice,
      instructions: `Payment required. Pay ${params.price} USDC/RLUSD to ${getPaymentReceiver()} (or per the invoice), then re-call this tool with payment_proof.tx_hash set to your payment transaction hash.`,
    };
  }

  // Proof provided -> verify the agent's on-chain payment via 402Proof.
  let resp: unknown;
  try {
    resp = await Proof402API.verify(params.paymentProof.txHash, endpointId);
  } catch (err) {
    return { status: 'payment_invalid', endpointId, detail: { error: String(err) } };
  }
  if (isVerified(resp)) {
    return { status: 'paid', txHash: params.paymentProof.txHash, detail: resp };
  }
  return { status: 'payment_invalid', endpointId, detail: resp };
}

/** Thrown by executeX402Payment when the agent must pay before the tool runs. */
export class PaymentRequiredError extends Error {
  constructor(public readonly gate: Extract<GateResult, { status: 'payment_required' }>) {
    super('payment_required');
    this.name = 'PaymentRequiredError';
  }
}

/** Thrown when the agent's payment proof fails 402Proof verification. */
export class PaymentUnverifiedError extends Error {
  constructor(public readonly gate: Extract<GateResult, { status: 'payment_invalid' }>) {
    super('payment_unverified');
    this.name = 'PaymentUnverifiedError';
  }
}
