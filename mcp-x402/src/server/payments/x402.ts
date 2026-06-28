import { z } from 'zod';
import { AuditLogger } from '../security/audit.js';
import { AP2Client } from './ap2.js';
import { WalletManager } from './wallet.js';
import { ChainRouter } from './router.js';
import { ReceiptStore } from './receipt.js';
import { CreditBureau } from '../../lib/credit/bureau.js';
import { PriceRegistry } from '../registry/pricing.js';

export const PaymentConfigSchema = z.object({
  price: z.string().regex(/^\d+(\.\d+)?$/),
  currency: z.enum(['USDC', 'RLUSD']),
  toolName: z.string(),
  walletAddress: z.string().optional(),
});

export type PaymentConfig = z.infer<typeof PaymentConfigSchema>;

export interface PaymentResult {
  receiptId: string;
  txHash: string;
  chain: string;
  amountPaid: string;
  currency: string;
  timestamp: number;
  walletAddress: string;
}

const AUTO_APPROVE_THRESHOLD = parseFloat(
  process.env['AUTO_APPROVE_THRESHOLD_USD'] ?? '1.0',
);

const DAILY_SPEND_CAP = parseFloat(
  process.env['DAILY_SPEND_CAP_USD'] ?? '50.0',
);

// SML's published Base USDC receiving address (public — see agents.json, llms.txt,
// x402-paywall.html). Used as the default so the gateway COLLECTS even when
// SML_PAYMENT_RECEIVER isn't set in the environment. Override via env to redirect.
// The private key (WALLET_SEED) is never stored here.
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

export async function executeX402Payment(
  config: PaymentConfig,
): Promise<PaymentResult> {
  const audit = AuditLogger.getInstance();
  const wallet = await WalletManager.getInstance().getOrCreateWallet();
  const walletAddress = wallet.address;

  // Enforce daily spend cap (N9)
  const priceNum = parseFloat(config.price);
  const currentSpend = getDailySpend(walletAddress);
  if (currentSpend + priceNum > DAILY_SPEND_CAP) {
    audit.warn('spend_cap_exceeded', {
      wallet: walletAddress,
      current: currentSpend,
      requested: priceNum,
      cap: DAILY_SPEND_CAP,
    });
    throw new Error(
      `Daily spend cap of $${DAILY_SPEND_CAP} exceeded. Current: $${currentSpend.toFixed(4)}`,
    );
  }

  // Verify price cache freshness (N12)
  const cachedPrice = await PriceRegistry.getInstance().getPrice(config.toolName);
  if (!cachedPrice) {
    throw new Error('Price data stale or unavailable. Rejecting payment.');
  }
  if (cachedPrice !== config.price) {
    throw new Error(
      `Price mismatch: expected ${cachedPrice}, got ${config.price}. Cache may be stale.`,
    );
  }

  // Credit Bureau check (N8)
  const score = await CreditBureau.getInstance().getScore(walletAddress);
  const autoApprove = priceNum <= AUTO_APPROVE_THRESHOLD && score >= 300;

  audit.info('payment_attempt', {
    tool: config.toolName,
    price: config.price,
    currency: config.currency,
    wallet: walletAddress,
    bureauScore: score,
    autoApprove,
  });

  if (!autoApprove && score < 300) {
    throw new Error(
      `Credit Bureau score ${score} below minimum 300. Payment requires manual approval.`,
    );
  }

  // AP2 mandate verification (N6)
  const ap2 = AP2Client.getInstance();
  const mandateValid = await ap2.verifyMandate(walletAddress, {
    maxAmount: config.price,
    currency: config.currency,
    toolName: config.toolName,
  });

  if (!mandateValid) {
    audit.warn('ap2_mandate_rejected', { wallet: walletAddress, tool: config.toolName });
    throw new Error(
      'AP2 mandate verification failed. Agent not authorized for this payment.',
    );
  }

  // Route payment to cheapest/fastest chain (N13)
  // Receiver defaults to SML's published address; only empty if explicitly set to ''.
  const receiver = getPaymentReceiver();
  let txResult: { txHash: string; chain: string; latencyMs: number };

  if (!receiver) {
    audit.warn('payment_receiver_unset', { tool: config.toolName, amount: config.price, note: 'SML_PAYMENT_RECEIVER explicitly empty — logging only' });
    txResult = { txHash: `pending-${Date.now()}`, chain: 'none', latencyMs: 0 };
  } else {
    try {
      const router = ChainRouter.getInstance();
      txResult = await router.route({
        amount: config.price,
        currency: config.currency,
        from: walletAddress,
        to: receiver,
        timeoutMs: 500,
      });
    } catch (err) {
      // Log payment failure but don't block tool execution
      audit.warn('payment_tx_failed', { tool: config.toolName, amount: config.price, error: String(err), note: 'Server wallet may be unfunded — tool served anyway' });
      txResult = { txHash: `failed-${Date.now()}`, chain: 'none', latencyMs: 0 };
    }
  }

  addDailySpend(walletAddress, priceNum);

  // Generate 402Proof receipt (N7)
  const receipt = await ReceiptStore.getInstance().create({
    txHash: txResult.txHash,
    chain: txResult.chain,
    amount: config.price,
    currency: config.currency,
    tool: config.toolName,
    wallet: walletAddress,
  });

  audit.info('payment_success', {
    receiptId: receipt.id,
    txHash: txResult.txHash,
    chain: txResult.chain,
    tool: config.toolName,
    wallet: walletAddress,
  });

  return {
    receiptId: receipt.id,
    txHash: txResult.txHash,
    chain: txResult.chain,
    amountPaid: config.price,
    currency: config.currency,
    timestamp: Date.now(),
    walletAddress,
  };
}

/**
 * Brokered payment for APM-executed tools (apm_execute). The amount is the
 * price-locked quote value + brokerage; its integrity is guaranteed by the
 * SML-signed quote verified upstream — NOT by the price registry. Mirrors the
 * settlement steps of executeX402Payment (cap, credit, AP2, route, receipt).
 * Never call without a verified, unexpired quote.
 */
export async function executeBrokeredPayment(params: {
  amount: string;
  toolName: string;
}): Promise<PaymentResult> {
  const { amount, toolName } = params;
  const currency = 'USDC' as const;
  const audit = AuditLogger.getInstance();
  const wallet = await WalletManager.getInstance().getOrCreateWallet();
  const walletAddress = wallet.address;

  // Daily spend cap (N9)
  const amountNum = parseFloat(amount);
  const currentSpend = getDailySpend(walletAddress);
  if (currentSpend + amountNum > DAILY_SPEND_CAP) {
    audit.warn('spend_cap_exceeded', { wallet: walletAddress, current: currentSpend, requested: amountNum, cap: DAILY_SPEND_CAP });
    throw new Error(`Daily spend cap of $${DAILY_SPEND_CAP} exceeded. Current: $${currentSpend.toFixed(4)}`);
  }

  // Credit Bureau check (N8)
  const score = await CreditBureau.getInstance().getScore(walletAddress);
  const autoApprove = amountNum <= AUTO_APPROVE_THRESHOLD && score >= 300;
  audit.info('brokered_payment_attempt', { tool: toolName, amount, wallet: walletAddress, bureauScore: score, autoApprove });
  if (!autoApprove && score < 300) {
    throw new Error(`Credit Bureau score ${score} below minimum 300. Payment requires manual approval.`);
  }

  // AP2 mandate verification (N6)
  const ap2 = AP2Client.getInstance();
  const mandateValid = await ap2.verifyMandate(walletAddress, { maxAmount: amount, currency, toolName });
  if (!mandateValid) {
    audit.warn('ap2_mandate_rejected', { wallet: walletAddress, tool: toolName });
    throw new Error('AP2 mandate verification failed. Agent not authorized for this payment.');
  }

  // Route payment (N13)
  const receiver = getPaymentReceiver();
  let txResult: { txHash: string; chain: string; latencyMs: number };
  if (!receiver) {
    audit.warn('payment_receiver_unset', { tool: toolName, amount, note: 'SML_PAYMENT_RECEIVER explicitly empty — logging only' });
    txResult = { txHash: `pending-${Date.now()}`, chain: 'none', latencyMs: 0 };
  } else {
    try {
      const router = ChainRouter.getInstance();
      txResult = await router.route({ amount, currency, from: walletAddress, to: receiver, timeoutMs: 500 });
    } catch (err) {
      audit.warn('payment_tx_failed', { tool: toolName, amount, error: String(err), note: 'Server wallet may be unfunded — tool served anyway' });
      txResult = { txHash: `failed-${Date.now()}`, chain: 'none', latencyMs: 0 };
    }
  }

  addDailySpend(walletAddress, amountNum);

  // 402Proof receipt (N7)
  const receipt = await ReceiptStore.getInstance().create({ txHash: txResult.txHash, chain: txResult.chain, amount, currency, tool: toolName, wallet: walletAddress });
  audit.info('brokered_payment_success', { receiptId: receipt.id, txHash: txResult.txHash, chain: txResult.chain, tool: toolName, wallet: walletAddress });

  return {
    receiptId: receipt.id,
    txHash: txResult.txHash,
    chain: txResult.chain,
    amountPaid: amount,
    currency,
    timestamp: Date.now(),
    walletAddress,
  };
}
