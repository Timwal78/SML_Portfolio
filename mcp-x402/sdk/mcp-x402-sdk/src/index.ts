import { z } from 'zod';

export type SupportedCurrency = 'USDC' | 'RLUSD';
export type SupportedChain = 'base' | 'xrpl' | 'solana';

export interface X402PaymentConfig<TInput extends z.ZodTypeAny> {
  price: string;
  currency?: SupportedCurrency;
  chain?: SupportedChain;
  inputSchema: TInput;
  handler: (input: z.infer<TInput>, receipt: PaymentReceipt) => Promise<ToolResult>;
}

export interface PaymentReceipt {
  receipt_id: string;
  tx_hash: string;
  chain: string;
  amount_paid: string;
  currency: string;
  timestamp: number;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

const PROOF402_URL = process.env['PROOF402_URL'] ?? 'https://four02proof.onrender.com';

/**
 * x402Payment — 5-line drop-in for any MCP server author.
 *
 * @example
 * server.tool('my_tool', schema, x402Payment({
 *   price: '0.01',
 *   currency: 'USDC',
 *   inputSchema: MyInputSchema,
 *   handler: async (input, receipt) => {
 *     return { content: [{ type: 'text', text: JSON.stringify({ result: 'data', receipt }) }] };
 *   },
 * }));
 */
export function x402Payment<TInput extends z.ZodTypeAny>(
  config: X402PaymentConfig<TInput>,
): (rawArgs: unknown) => Promise<ToolResult> {
  return async (rawArgs: unknown): Promise<ToolResult> => {
    const parsed = config.inputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'validation_error', issues: parsed.error.issues }) }],
        isError: true,
      };
    }

    const args = parsed.data as z.infer<TInput>;
    const walletAddress = (args as Record<string, unknown>)['wallet_address'] as string | undefined;

    let receipt: PaymentReceipt;
    try {
      receipt = await processPayment({
        price: config.price,
        currency: config.currency ?? 'USDC',
        chain: config.chain,
        walletAddress,
      });
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }],
        isError: true,
      };
    }

    return config.handler(args, receipt);
  };
}

async function processPayment(params: {
  price: string;
  currency: SupportedCurrency;
  chain?: SupportedChain;
  walletAddress?: string;
}): Promise<PaymentReceipt> {
  // Delegates to the 402Proof payment endpoint
  const res = await fetch(`${PROOF402_URL}/v1/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: params.price,
      currency: params.currency,
      chain: params.chain ?? 'base',
      wallet: params.walletAddress,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Payment failed: HTTP ${res.status}`);
  }

  const body = (await res.json()) as {
    receipt_id: string;
    tx_hash: string;
    chain: string;
    amount: string;
    currency: string;
  };

  return {
    receipt_id: body.receipt_id,
    tx_hash: body.tx_hash,
    chain: body.chain,
    amount_paid: body.amount,
    currency: body.currency,
    timestamp: Date.now(),
  };
}

export { x402Payment as default };
