import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CAPABILITIES } from '../../src/server/apm/capabilities.js';
import { matchManifest, scoreCapability, tokenize, evaluateFit } from '../../src/server/apm/matcher.js';
import { createQuote, verifyQuote } from '../../src/server/apm/quote.js';
import type { Constraints } from '../../src/server/apm/schema.js';

const ALL_LIVE = new Set(CAPABILITIES.map((c) => c.product));

describe('APM matcher', () => {
  it('tokenizes on alphanumerics, lowercased', () => {
    expect(tokenize('Real-time SQUEEZE signal for GME!')).toEqual(['real', 'time', 'squeeze', 'signal', 'for', 'gme']);
  });

  it('scores tag hits double', () => {
    const cap = CAPABILITIES.find((c) => c.tool === 'squeezeos_council')!;
    // "squeeze" is a tag -> +1 haystack +1 tag = 2
    expect(scoreCapability(cap, ['squeeze'])).toBe(2);
    // unrelated token scores 0
    expect(scoreCapability(cap, ['memecoin'])).toBe(0);
  });

  it('returns squeeze tools ranked first for a squeeze need', () => {
    const matches = matchManifest('squeeze signal for a stock ticker', {}, CAPABILITIES, ALL_LIVE);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]!.product).toBe('SqueezeOS');
    // sorted by score desc
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1]!.score).toBeGreaterThanOrEqual(matches[i]!.score);
    }
  });

  it('routes SEC filing needs to xmit with attribution', () => {
    const matches = matchManifest('parse a 13F SEC filing', {}, CAPABILITIES, ALL_LIVE);
    const xmit = matches.find((m) => m.tool === 'xmit_edgar_decode');
    expect(xmit).toBeDefined();
    expect(xmit!.attribution).toBe(true);
  });

  it('marks price fit false when over budget', () => {
    const c: Constraints = { max_price_usd: 0.04 };
    const council = CAPABILITIES.find((x) => x.tool === 'squeezeos_council')!; // 0.10
    expect(evaluateFit(council, c).price).toBe(false);
    const iwm = CAPABILITIES.find((x) => x.tool === 'squeezeos_iwm')!; // 0.03
    expect(evaluateFit(iwm, c).price).toBe(true);
  });

  it('marks chain fit false when accepted chains exclude a paid tool', () => {
    const rails = CAPABILITIES.find((x) => x.tool === 'rails_transfer')!; // xrpl only
    expect(evaluateFit(rails, { chains_accepted: ['base'] }).chain).toBe(false);
    expect(evaluateFit(rails, { chains_accepted: ['xrpl'] }).chain).toBe(true);
  });

  it('honors needs_attribution', () => {
    const forge = CAPABILITIES.find((x) => x.tool === 'forge_llm')!;
    expect(evaluateFit(forge, { needs_attribution: true }).attribution).toBe(false);
    const ftd = CAPABILITIES.find((x) => x.tool === 'ftd_threshold_scan')!;
    expect(evaluateFit(ftd, { needs_attribution: true }).attribution).toBe(true);
  });

  it('reflects live-status from the injected set', () => {
    const onlyForge = new Set(['Forge Gateway']);
    const matches = matchManifest('llm model completion', {}, CAPABILITIES, onlyForge);
    const forge = matches.find((m) => m.tool === 'forge_llm')!;
    expect(forge.live).toBe(true);
  });

  it('returns no matches for an unrelated need', () => {
    expect(matchManifest('xyzzy plugh nonsense', {}, CAPABILITIES, ALL_LIVE)).toEqual([]);
  });
});

describe('APM quote', () => {
  const baseTerms = {
    tool: 'squeezeos_council',
    price_usd: '0.10',
    payment_chains: ['base', 'xrpl', 'solana'],
    brokerage_commission_pct: 5,
    ttl_sec: 300,
  };

  afterEach(() => {
    delete process.env['APM_QUOTE_SECRET'];
  });

  it('issues an unsigned quote when no secret is set', () => {
    delete process.env['APM_QUOTE_SECRET'];
    const q = createQuote(baseTerms);
    expect(q.signed).toBe(false);
    expect(q.signature).toBe('');
    expect(q.quote_id).toHaveLength(24);
    expect(new Date(q.expires_at).getTime()).toBeGreaterThan(new Date(q.issued_at).getTime());
  });

  it('signs and verifies when a secret is set', () => {
    process.env['APM_QUOTE_SECRET'] = 'test-secret-123';
    const q = createQuote(baseTerms);
    expect(q.signed).toBe(true);
    expect(q.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyQuote(q.canonical, q.signature)).toBe(true);
    expect(verifyQuote(q.canonical, 'deadbeef')).toBe(false);
  });

  it('sorts payment chains canonically', () => {
    const q = createQuote({ ...baseTerms, payment_chains: ['solana', 'base', 'xrpl'] });
    expect(q.payment_chains).toEqual(['base', 'solana', 'xrpl']);
  });
});
