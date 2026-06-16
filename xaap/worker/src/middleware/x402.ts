import type { Context, Next } from 'hono';
import type { Env } from '../types/index.js';

export interface X402Config {
  amountUsdc: string;   // in USDC smallest units (6 decimals), e.g. '10000' = $0.01
  description: string;
  resource: string;
}

// USDC on Base mainnet
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

export function requirePayment(config: X402Config) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const payment = c.req.header('X-Payment');

    if (!payment) {
      c.header('Content-Type', 'application/json');
      return c.json({
        x402Version: 1,
        error: 'Payment required',
        accepts: [
          {
            scheme: 'exact',
            network: 'base-mainnet',
            maxAmountRequired: config.amountUsdc,
            resource: config.resource,
            description: config.description,
            mimeType: 'application/json',
            payTo: c.env.MERCHANT_WALLET_ADDRESS,
            maxTimeoutSeconds: 300,
            asset: USDC_BASE,
            extra: { name: 'USDC', version: '3' },
          },
        ],
      }, 402);
    }

    // Verify with facilitator
    const valid = await verifyPayment(payment, config, c.env);
    if (!valid) {
      return c.json({ error: 'Invalid or expired payment' }, 402);
    }

    // Attach payment proof to context
    c.set('paymentProof' as never, payment);
    await next();
  };
}

async function verifyPayment(payment: string, config: X402Config, env: Env): Promise<boolean> {
  try {
    const res = await fetch(`${env.X402_FACILITATOR_URL}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        scheme: 'exact',
        network: 'base-mainnet',
        payload: payment,
        requirements: {
          maxAmountRequired: config.amountUsdc,
          payTo: env.MERCHANT_WALLET_ADDRESS,
          asset: USDC_BASE,
        },
      }),
    });
    if (!res.ok) return false;
    const data = await res.json<{ isValid: boolean }>();
    return data.isValid === true;
  } catch {
    // If facilitator is unreachable, fail closed
    return false;
  }
}
