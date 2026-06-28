/**
 * APM price-locked quote — a real, verifiable HMAC-signed quote.
 *
 * The quote binds {tool, price, chains, brokerage, expiry} so an agent can rely on
 * the price for `ttl_sec`. Signed with HMAC-SHA256 over a canonical payload using
 * APM_QUOTE_SECRET. If the secret is unset, the quote is still issued but marked
 * `signed: false` (honest signalling — never a fake signature).
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface QuoteTerms {
  tool: string;
  price_usd: string;
  payment_chains: string[];
  brokerage_commission_pct: number;
  ttl_sec: number;
  agent_id?: string;
}

export interface SignedQuote {
  quote_id: string;
  tool: string;
  price_usd: string;
  currency: 'USDC';
  payment_chains: string[];
  brokerage_commission_pct: number;
  agent_id: string | null;
  issued_at: string;
  expires_at: string;
  algo: 'HMAC-SHA256';
  signature: string;
  signed: boolean;
  canonical: string;
}

function canonicalize(payload: Record<string, unknown>): string {
  // Deterministic: sorted top-level keys (array form selects + orders keys).
  return JSON.stringify(payload, Object.keys(payload).sort());
}

export function createQuote(terms: QuoteTerms): SignedQuote {
  const issuedMs = Date.now();
  const expiresMs = issuedMs + terms.ttl_sec * 1000;

  const payload = {
    tool: terms.tool,
    price_usd: terms.price_usd,
    currency: 'USDC' as const,
    payment_chains: [...terms.payment_chains].sort(),
    brokerage_commission_pct: terms.brokerage_commission_pct,
    agent_id: terms.agent_id ?? null,
    issued_at: new Date(issuedMs).toISOString(),
    expires_at: new Date(expiresMs).toISOString(),
  };

  const canonical = canonicalize(payload);
  const quoteId = createHash('sha256').update(canonical).digest('hex').slice(0, 24);

  const secret = process.env['APM_QUOTE_SECRET'] ?? '';
  const signed = secret.length > 0;
  const signature = signed
    ? createHmac('sha256', secret).update(canonical).digest('hex')
    : '';

  return {
    quote_id: quoteId,
    tool: payload.tool,
    price_usd: payload.price_usd,
    currency: payload.currency,
    payment_chains: payload.payment_chains,
    brokerage_commission_pct: payload.brokerage_commission_pct,
    agent_id: payload.agent_id,
    issued_at: payload.issued_at,
    expires_at: payload.expires_at,
    algo: 'HMAC-SHA256',
    signature,
    signed,
    canonical,
  };
}

/** Verify a quote's signature against APM_QUOTE_SECRET. Returns false if unsigned/unset. */
export function verifyQuote(canonical: string, signature: string): boolean {
  const secret = process.env['APM_QUOTE_SECRET'] ?? '';
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(canonical).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
