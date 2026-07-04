import { z } from 'zod';
import { AuditLogger } from '../security/audit.js';
import { ReceiptStore } from './receipt.js';
import { CreditBureau } from '../../lib/credit/bureau.js';
import { alreadyRedeemed, markRedeemed, verifyBaseUsdcPayment } from './verify-inbound.js';
import { facilitatorChain, decodePaymentHeader, usdcAddress, type PaymentRequirements } from './facilitators.js';
import { PriceRegistry } from '../registry/pricing.js';

export const PaymentConfigSchema = z.object({
  price: z.string().regex(/^\d+(\.\d+)?$/),
  currency: z.enum(['USDC', 'RLUSD']),
  toolName: z.string(),
  /** Caller-declared payer — informational only. The verified payer (below) is what's actually authorized. */
  walletAddress: z.string().optional(),
  /** Rail B (sovereign): a Base tx hash proving a real on-chain USDC transfer to the operator's receiving address. */
  paymentTxHash: z.string().optional(),
  /** Rail A (standard): a base64 X-PAYMENT-style EIP-3009 payload, verified + settled via the facilitator chain. */
  paymentHeader: z.string().optional(),
});

export type PaymentConfig = z.infer<typeof PaymentConfigSchema>;

export interface PaymentResult {
  receiptId: string;
  txHash: string;
  chain: string;
  amountPaid: string;
  currency: string;
  timestamp: number;
  /** The address that was actually verified to have paid — never the operator's own wallet. */
  walletAddress: string;
}

const DAILY_SPEND_CAP = parseFloat(
  process.env['DAILY_SPEND_CAP_USD'] ?? '50.0',
);

// SML's published Base USDC receiving address (public — see agents.json, llms.txt,
// x402-paywall.html). Used as the default so the gateway COLLECTS even when
// SML_PAYMENT_RECEIVER isn't set in the environment.
const SML_DEFAULT_RECEIVER = '0x4e14B249D9A4c9c9352D780eCEB508A8eB7a7700';

/** Resolve the address that collects USDC for paid tool calls. */
export function getPaymentReceiver(): string {
  return process.env['SML_PAYMENT_RECEIVER'] ?? SML_DEFAULT_RECEIVER;
}

const dailySpend = new Map<string, { amount: number; date: string }>();

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDailySpend(wallet: string): number {
  const today = getTodayKey();
  const entry = dailySpend.get(wallet);
  if (!entry || entry.date !== today) return 0;
  return entry.amount;
}

function addDailySpend(wallet: string, amount: number): void {
  const today = getTodayKey();
  const current = getDailySpend(wallet);
  dailySpend.set(wallet, { amount: current + amount, date: today });
}

/** USDC has 6 decimals. Converts a decimal price string ("0.10") to base units (100000n). */
export function usdcToUnits(price: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(price)) {
    throw new Error(`invalid_price_format: ${price}`);
  }
  const [whole = '0', frac = ''] = price.split('.');
  const fracPadded = (frac + '000000').slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(fracPadded || '0');
}

function paymentRequiredMessage(toolName: string, price: string): string {
  const payTo = getPaymentReceiver();
  return (
    `Payment required: send ${price} USDC on Base to ${payTo}, then retry this call with ` +
    `payment_tx_hash="<your on-chain tx hash>" (sovereign rail) or ` +
    `payment_header="<base64 X-PAYMENT EIP-3009 payload>" (facilitator-settled rail). Tool: ${toolName}.`
  );
}

interface VerifiedPayment {
  payer: string;
  txHash: string;
  rail: string;
}

/**
 * Verifies one of the two payment rails and returns the REAL payer address.
 * Identical verification logic to the REST /x402/* endpoints in server/index.ts
 * (the one part of this codebase with a working, tested payment flow) — just
 * reshaped for MCP tool-call arguments instead of HTTP headers, since a
 * `server.tool()` handler only receives `rawArgs`, not the request/response.
 */
async function verifyPayment(config: PaymentConfig, priceUnits: bigint): Promise<VerifiedPayment> {
  const payTo = getPaymentReceiver();

  if (config.paymentTxHash) {
    if (alreadyRedeemed(config.paymentTxHash)) {
      throw new Error(`payment_already_redeemed: tx ${config.paymentTxHash} was already used for a previous call`);
    }
    const v = await verifyBaseUsdcPayment({ txHash: config.paymentTxHash, payTo, minAmountUnits: priceUnits });
    if (!v.ok) {
      throw new Error(`payment_unverified: ${v.error ?? 'unknown'}`);
    }
    markRedeemed(config.paymentTxHash);
    return { payer: v.from || config.walletAddress || 'unknown', txHash: config.paymentTxHash, rail: 'sovereign' };
  }

  if (config.paymentHeader) {
    const payload = decodePaymentHeader(config.paymentHeader);
    if (!payload) {
      throw new Error('invalid_payment_payload: could not decode payment_header');
    }
    const requirements: PaymentRequirements = {
      scheme: 'exact',
      network: 'eip155:8453',
      maxAmountRequired: priceUnits.toString(),
      resource: `mcp-tool:${config.toolName}`,
      description: `x402 payment for ${config.toolName}`,
      mimeType: 'application/json',
      payTo,
      maxTimeoutSeconds: 300,
      asset: usdcAddress(),
      extra: { name: 'USD Coin', version: '2' },
    };
    const result = await facilitatorChain().process(payload, requirements);
    if (!result.success) {
      throw new Error(`payment_unsettled: ${result.errorReason ?? 'unknown'}`);
    }
    const payer = result.payer ?? payload.payload.authorization.from;
    return { payer, txHash: result.transaction ?? '', rail: `standard:${result.facilitator ?? ''}` };
  }

  throw new Error(paymentRequiredMessage(config.toolName, config.price));
}

/**
 * Core verification + settlement, shared by executeX402Payment and
 * executeBrokeredPayment. Verifies a REAL inbound USDC payment for an MCP
 * tool call and enforces the daily spend cap + credit-bureau scoring against
 * the VERIFIED PAYER's address — never the operator's own server wallet.
 *
 * AP2 mandate verification is intentionally NOT part of this path. The REST
 * /x402/* endpoints (the only demonstrably-working payment surface in this
 * codebase) never call it either, and every wallet — including the operator's
 * own — currently fails it because no mandate has ever been registered
 * anywhere. A verified on-chain payment (or a facilitator-settled EIP-3009
 * transfer) is a strictly stronger authorization signal than an unregistered
 * mandate check would be, so this drops the AP2 gate rather than requiring
 * every real customer to pass a check nothing has ever satisfied.
 */
async function verifyAndSettle(config: PaymentConfig): Promise<PaymentResult> {
  const audit = AuditLogger.getInstance();

  if (config.currency !== 'USDC') {
    throw new Error(`unsupported_currency: only USDC on Base is currently verifiable, got ${config.currency}`);
  }

  const priceUnits = usdcToUnits(config.price);
  const verified = await verifyPayment(config, priceUnits);

  // Daily spend cap — keyed to the REAL verified payer.
  const priceNum = parseFloat(config.price);
  const currentSpend = getDailySpend(verified.payer);
  if (currentSpend + priceNum > DAILY_SPEND_CAP) {
    audit.warn('spend_cap_exceeded', { wallet: verified.payer, current: currentSpend, requested: priceNum, cap: DAILY_SPEND_CAP });
    throw new Error(`Daily spend cap of $${DAILY_SPEND_CAP} exceeded for ${verified.payer}. Current: $${currentSpend.toFixed(4)}`);
  }
  addDailySpend(verified.payer, priceNum);

  // Credit bureau — informational scoring of the real payer. New/unknown
  // wallets default to 300 (see CreditBureau.getScore), so this never blocks
  // a first-time payer; it only builds their score history going forward.
  const score = await CreditBureau.getInstance().getScore(verified.payer);

  const receipt = await ReceiptStore.getInstance().create({
    txHash: verified.txHash,
    chain: 'base',
    amount: config.price,
    currency: config.currency,
    tool: config.toolName,
    wallet: verified.payer,
  });

  audit.info('payment_verified', {
    receiptId: receipt.id,
    tool: config.toolName,
    price: config.price,
    payer: verified.payer,
    rail: verified.rail,
    txHash: verified.txHash,
    bureauScore: score,
  });

  return {
    receiptId: receipt.id,
    txHash: verified.txHash,
    chain: 'base',
    amountPaid: config.price,
    currency: config.currency,
    timestamp: Date.now(),
    walletAddress: verified.payer,
  };
}

/**
 * Public entry point for ordinary paid tools. Adds one guard on top of
 * verifyAndSettle: the price the caller passed in must match PriceRegistry's
 * current price for that tool, so a stale/tampered price can never be quoted
 * to a payer or verified against on-chain.
 */
export async function executeX402Payment(config: PaymentConfig): Promise<PaymentResult> {
  const cachedPrice = await PriceRegistry.getInstance().getPrice(config.toolName);
  if (!cachedPrice) {
    throw new Error('Price data stale or unavailable. Rejecting payment.');
  }
  if (cachedPrice !== config.price) {
    throw new Error(`Price mismatch: expected ${cachedPrice}, got ${config.price}. Cache may be stale.`);
  }
  return verifyAndSettle(config);
}

/**
 * Brokered payment for APM-executed tools (apm_execute). The amount is the
 * price-locked quote value + brokerage; its integrity is guaranteed by the
 * SML-signed quote verified upstream — NOT by the price registry, so this
 * intentionally calls verifyAndSettle directly and skips the PriceRegistry
 * cache-freshness check (apm_execute's pseudo tool name, e.g.
 * "apm_execute:squeezeos_council", is never a real PriceRegistry key).
 */
export async function executeBrokeredPayment(params: {
  amount: string;
  toolName: string;
  walletAddress?: string;
  paymentTxHash?: string;
  paymentHeader?: string;
}): Promise<PaymentResult> {
  return verifyAndSettle({
    price: params.amount,
    currency: 'USDC',
    toolName: params.toolName,
    walletAddress: params.walletAddress,
    paymentTxHash: params.paymentTxHash,
    paymentHeader: params.paymentHeader,
  });
}
