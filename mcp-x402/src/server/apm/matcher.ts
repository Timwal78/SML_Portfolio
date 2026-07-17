/**
 * APM matcher — deterministic, pure functions that turn an agent's stated need
 * into a ranked list of SML capabilities with per-constraint fit. No randomness,
 * no network: live-status is injected by the caller.
 */

import type { Capability } from './capabilities.js';
import type { Constraints, ConstraintFit, ScoredMatch } from './schema.js';

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** Keyword overlap score between a need and a capability. Tag hits weigh double. */
export function scoreCapability(cap: Capability, needTokens: string[]): number {
  const haystack = new Set<string>([
    ...cap.tags,
    ...tokenize(cap.tool),
    ...tokenize(cap.summary),
    ...tokenize(cap.product),
  ]);
  const tagSet = new Set(cap.tags);
  let score = 0;
  for (const token of needTokens) {
    if (haystack.has(token)) score += 1;
    if (tagSet.has(token)) score += 1; // tags are the strongest signal
  }
  return score;
}

export function evaluateFit(cap: Capability, c: Constraints): ConstraintFit {
  const price =
    c.max_price_usd === undefined || Number(cap.basePrice) <= c.max_price_usd;

  const chain =
    !cap.paid ||
    c.chains_accepted === undefined ||
    c.chains_accepted.length === 0 ||
    cap.paymentChains.some((ch) => c.chains_accepted!.includes(ch as 'base' | 'xrpl' | 'solana'));

  const freshness =
    c.max_freshness_sec === undefined || cap.freshnessSec <= c.max_freshness_sec;

  const attribution = c.needs_attribution !== true || cap.attribution === true;

  return { price, chain, freshness, attribution };
}

/**
 * Rank capabilities against a need. Returns only positive-score matches,
 * sorted by score desc, then price asc. `live` is the set of online product keys.
 */
export function matchManifest(
  need: string,
  constraints: Constraints,
  capabilities: Capability[],
  live: Set<string>,
): ScoredMatch[] {
  const tokens = tokenize(need);

  return capabilities
    .map((cap): ScoredMatch => {
      const score = scoreCapability(cap, tokens);
      const fits = evaluateFit(cap, constraints);
      return {
        tool: cap.tool,
        product: cap.product,
        summary: cap.summary,
        paid: cap.paid,
        price_usd: cap.basePrice,
        payment_chains: cap.paymentChains,
        freshness_sec: cap.freshnessSec,
        attribution: cap.attribution,
        live: live.has(cap.product),
        score,
        fits,
        meets_all_constraints:
          fits.price && fits.chain && fits.freshness && fits.attribution,
      };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || Number(a.price_usd) - Number(b.price_usd));
}
