import { describe, it, expect, afterEach } from 'vitest';
import { brokeredTotal, isBrokerable, brokerableTools } from '../../src/server/apm/execute.js';
import { createQuote, verifyAndParseQuote } from '../../src/server/apm/quote.js';

describe('apm_execute — brokerage math', () => {
  it('adds the commission at USDC precision', () => {
    expect(brokeredTotal('0.10', 5)).toBe('0.105');
    expect(brokeredTotal('0.05', 5)).toBe('0.0525');
    expect(brokeredTotal('0.005', 5)).toBe('0.00525');
  });

  it('is a no-op at 0%', () => {
    expect(brokeredTotal('0.10', 0)).toBe('0.1');
  });
});

describe('apm_execute — brokerable guard', () => {
  it('brokers the live SqueezeOS family, not arbitrary tools', () => {
    expect(isBrokerable('squeezeos_council')).toBe(true);
    expect(isBrokerable('squeezeos_iwm')).toBe(true);
    expect(isBrokerable('forge_llm')).toBe(false);
    expect(isBrokerable('rails_transfer')).toBe(false);
    expect(brokerableTools()).toContain('squeezeos_scan');
  });
});

describe('apm_execute — quote verification', () => {
  afterEach(() => {
    delete process.env['APM_QUOTE_SECRET'];
  });

  const terms = {
    tool: 'squeezeos_council',
    price_usd: '0.10',
    payment_chains: ['base', 'xrpl', 'solana'],
    brokerage_commission_pct: 5,
    ttl_sec: 300,
  };

  it('accepts a valid, unexpired, signed quote and parses its fields', () => {
    process.env['APM_QUOTE_SECRET'] = 'secret-xyz';
    const q = createQuote(terms);
    const check = verifyAndParseQuote(q.canonical, q.signature);
    expect(check.valid).toBe(true);
    expect(check.expired).toBe(false);
    expect(check.quote?.tool).toBe('squeezeos_council');
    expect(check.quote?.price_usd).toBe('0.10');
    expect(check.quote?.brokerage_commission_pct).toBe(5);
  });

  it('rejects a tampered signature', () => {
    process.env['APM_QUOTE_SECRET'] = 'secret-xyz';
    const q = createQuote(terms);
    const check = verifyAndParseQuote(q.canonical, 'deadbeef');
    expect(check.valid).toBe(false);
    expect(check.reason).toBe('signature_invalid_or_unsigned');
  });

  it('rejects when no secret is configured (unsigned quote cannot be verified)', () => {
    delete process.env['APM_QUOTE_SECRET'];
    const q = createQuote(terms); // signed:false
    const check = verifyAndParseQuote(q.canonical, q.signature);
    expect(check.valid).toBe(false);
  });

  it('flags an expired quote as valid-but-expired', () => {
    process.env['APM_QUOTE_SECRET'] = 'secret-xyz';
    const q = createQuote({ ...terms, ttl_sec: -1 }); // already expired
    const check = verifyAndParseQuote(q.canonical, q.signature);
    expect(check.valid).toBe(true);
    expect(check.expired).toBe(true);
  });
});
