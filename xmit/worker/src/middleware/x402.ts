import type { Context, Next } from 'hono';
import type { Env, PaymentRequired } from '../types';

export interface X402Config {
  amountMicro: number;
  description: string;
  payTo: string;
}

export function x402Gate(config: X402Config) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const paymentHeader = c.req.header('X-PAYMENT');

    if (!paymentHeader) {
      const usdcAmount = (config.amountMicro / 1_000_000).toFixed(6);
      const resource = new URL(c.req.url).pathname;

      const paymentRequired: PaymentRequired = {
        type: 'x402',
        accepts: [
          {
            scheme: 'exact',
            network: 'base',
            maxAmountRequired: config.amountMicro.toString(),
            resource,
            description: config.description,
            mimeType: 'application/json',
            payTo: config.payTo,
            maxTimeoutSeconds: 300,
            asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            extra: { name: 'USDC', version: '2' },
          },
        ],
      };

      return c.json(
        {
          error: 'Payment required',
          amount: `${usdcAmount} USDC`,
          x402: paymentRequired,
        },
        402
      );
    }

    const verified = await verifyX402Payment(paymentHeader, config, c.env);
    if (!verified.ok) {
      return c.json({ error: 'Invalid payment', detail: verified.error }, 402);
    }

    c.set('payerAddress', verified.payerAddress);
    c.set('paymentTxHash', verified.txHash);
    await next();
  };
}

async function verifyX402Payment(
  paymentHeader: string,
  config: X402Config,
  env: Env
): Promise<{ ok: boolean; payerAddress?: string; txHash?: string; error?: string }> {
  try {
    const facilitatorUrl = env.X402_FACILITATOR_URL || 'https://x402.org/facilitator';
    const resp = await fetch(`${facilitatorUrl}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payment: paymentHeader,
        network: 'base',
        maxAmountRequired: config.amountMicro.toString(),
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        payTo: config.payTo,
      }),
    });

    if (!resp.ok) return { ok: false, error: 'Facilitator rejected payment' };
    const data = (await resp.json()) as {
      valid: boolean;
      payerAddress?: string;
      txHash?: string;
      error?: string;
    };

    if (!data.valid) return { ok: false, error: data.error ?? 'Payment invalid' };
    return { ok: true, payerAddress: data.payerAddress, txHash: data.txHash };
  } catch (e) {
    return { ok: false, error: 'Payment verification failed' };
  }
}
