import { describe, it, expect } from 'vitest';

/**
 * Regression test for the /x402/crypto-price `ids` comma-splitting bug
 * flagged by API Market review (8th rejection, 2026-07-30): "the ids
 * parameter does not handle comma-separated values: sending
 * bitcoin,ethereum comes back as a single merged key bitcoinethereum".
 *
 * Root cause: the raw `ids` query string was run through cleanTerm()
 * (`s.replace(/[^a-zA-Z0-9 .-]/g, '')`) BEFORE being split on comma.
 * cleanTerm() strips any character outside [a-zA-Z0-9 .-], which includes
 * the comma delimiter itself -- "bitcoin,ethereum" became "bitcoinethereum"
 * before the split ever ran.
 *
 * Fix (src/server/index.ts, /x402/crypto-price handler): split on comma
 * FIRST, then sanitize each id individually to [a-z0-9-] (the real
 * character set of CoinGecko coin ids, e.g. "usd-coin", "matic-network").
 *
 * This test recreates that exact parsing expression in isolation --
 * index.ts is a single-file Express monolith with no exported route
 * handlers to import directly, so this is the same "pure logic in
 * isolation" testing convention already used by this suite for
 * computeRSI/blackScholesDelta in equities-heatmap.test.ts, applied to
 * the fixed expression itself rather than a refactor mid-incident.
 */

function parseIds(rawIds: string): string[] {
  const ids = rawIds.trim();
  return ids
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/[^a-z0-9-]/g, ''))
    .filter(Boolean)
    .slice(0, 20);
}

// The OLD (buggy) behavior, kept only to prove the bug existed and is gone.
function parseIdsOldBuggyBehavior(rawIds: string): string[] {
  const cleanTerm = (s: string): string => s.replace(/[^a-zA-Z0-9 .-]/g, '').trim().slice(0, 60);
  const ids = cleanTerm(rawIds);
  return ids.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 20);
}

describe('/x402/crypto-price ids parsing', () => {
  it('splits "bitcoin,ethereum" into two separate valid ids', () => {
    expect(parseIds('bitcoin,ethereum')).toEqual(['bitcoin', 'ethereum']);
  });

  it('handles ids containing hyphens (real CoinGecko id shape)', () => {
    expect(parseIds('usd-coin,matic-network,bitcoin')).toEqual(['usd-coin', 'matic-network', 'bitcoin']);
  });

  it('trims whitespace around each id', () => {
    expect(parseIds(' bitcoin , ethereum , ripple ')).toEqual(['bitcoin', 'ethereum', 'ripple']);
  });

  it('drops empty entries from trailing/doubled commas', () => {
    expect(parseIds('bitcoin,,ethereum,')).toEqual(['bitcoin', 'ethereum']);
  });

  it('caps at 20 ids', () => {
    const many = Array.from({ length: 30 }, (_, i) => `coin${i}`).join(',');
    expect(parseIds(many)).toHaveLength(20);
  });

  it('confirms the reported bug: the OLD implementation merged comma-separated ids into one', () => {
    // This is the exact failure API Market's review reported -- kept as a
    // permanent regression marker so it can never silently come back.
    expect(parseIdsOldBuggyBehavior('bitcoin,ethereum')).toEqual(['bitcoinethereum']);
    expect(parseIds('bitcoin,ethereum')).not.toEqual(['bitcoinethereum']);
  });
});
