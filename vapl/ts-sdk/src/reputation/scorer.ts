import { verifyVCBatch } from '../credentials/verifier';
import type { VerifiableCredential, InteractionClaim, AccuracyClaim, ContributionClaim } from '../credentials/schema';

export interface ReputationWeights {
  accuracy: number;
  reliability: number;
  contribution: number;
  tenure: number;
}

const DEFAULT_WEIGHTS: ReputationWeights = {
  accuracy: 0.40,
  reliability: 0.30,
  contribution: 0.20,
  tenure: 0.10,
};

export interface ReputationScore {
  overall: number;
  components: { accuracy: number; reliability: number; contribution: number; tenure: number };
  evidence: {
    totalInteractions: number;
    successfulInteractions: number;
    verifiedPredictions: number;
    accuratePredictions: number;
    contributions: number;
    firstSeenTimestamp: string | null;
    lastSeenTimestamp: string | null;
  };
  computedAt: string;
  credentialCount: number;
  invalidCredentials: number;
}

function timeDecayWeight(timestamp: string, now: Date, halfLifeDays: number): number {
  const ageDays = (now.getTime() - new Date(timestamp).getTime()) / 86400000;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

export function computeReputationScore(
  credentials: VerifiableCredential[],
  subjectDid: string,
  options: {
    weights?: Partial<ReputationWeights>;
    trustedIssuers?: string[];
    decayHalfLifeDays?: number;
    now?: Date;
  } = {},
): ReputationScore {
  const now = options.now ?? new Date();
  const halfLife = options.decayHalfLifeDays ?? 30;
  const w = { ...DEFAULT_WEIGHTS, ...options.weights };
  const totalW = w.accuracy + w.reliability + w.contribution + w.tenure;
  const nw = { accuracy: w.accuracy / totalW, reliability: w.reliability / totalW,
               contribution: w.contribution / totalW, tenure: w.tenure / totalW };

  const { valid: validVCs, invalid } = verifyVCBatch(credentials, {
    ...(options.trustedIssuers !== undefined ? { trustedIssuers: options.trustedIssuers } : {}),
    checkExpiry: false,
    now,
  });

  const subjectVCs = validVCs.filter(vc => vc.credentialSubject.id === subjectDid);

  const interactions: Array<{ claim: InteractionClaim; timestamp: string }> = [];
  const accuracyClaims: AccuracyClaim[] = [];
  const contributions: ContributionClaim[] = [];
  let firstSeen: Date | null = null;
  let lastSeen: Date | null = null;

  for (const vc of subjectVCs) {
    const ts = new Date(vc.validFrom);
    if (!firstSeen || ts < firstSeen) firstSeen = ts;
    if (!lastSeen || ts > lastSeen) lastSeen = ts;

    const subj = vc.credentialSubject as Record<string, unknown>;
    if (subj['interaction']) interactions.push({ claim: subj['interaction'] as InteractionClaim, timestamp: vc.validFrom });
    if (subj['accuracy']) accuracyClaims.push(subj['accuracy'] as AccuracyClaim);
    if (subj['contribution']) contributions.push(subj['contribution'] as ContributionClaim);
  }

  const accuracyScore = accuracyClaims.length > 0
    ? accuracyClaims.reduce((s, c) => s + Math.min(1, Math.max(0, c.accuracyScore)), 0) / accuracyClaims.length
    : 0;

  let reliabilityScore = 0;
  if (interactions.length > 0) {
    let wSuccess = 0, wTotal = 0;
    for (const { claim, timestamp } of interactions) {
      const dw = timeDecayWeight(timestamp, now, halfLife);
      const s = claim.outcome === 'success' ? 1 : claim.outcome === 'partial' ? 0.5 : 0;
      wSuccess += dw * s;
      wTotal += dw;
    }
    reliabilityScore = wTotal > 0 ? wSuccess / wTotal : 0;
  }

  let contributionScore = 0;
  if (contributions.length > 0) {
    const typeW: Record<string, number> = {
      MarketplaceListing: 1.0, DataContribution: 1.5, RelayNode: 2.0, AlphaMeshNode: 2.0,
    };
    const weighted = contributions.reduce((s, c) => s + (typeW[c.contributionType] ?? 1), 0);
    contributionScore = Math.min(1, Math.log10(1 + weighted) / 2);
  }

  const tenureScore = firstSeen
    ? Math.min(1, Math.log(1 + (now.getTime() - firstSeen.getTime()) / 86400000) / Math.log(366))
    : 0;

  const overall = nw.accuracy * accuracyScore + nw.reliability * reliabilityScore +
    nw.contribution * contributionScore + nw.tenure * tenureScore;

  const round = (n: number) => Math.round(n * 1000) / 1000;

  return {
    overall: round(overall),
    components: {
      accuracy: round(accuracyScore),
      reliability: round(reliabilityScore),
      contribution: round(contributionScore),
      tenure: round(tenureScore),
    },
    evidence: {
      totalInteractions: interactions.length,
      successfulInteractions: interactions.filter(i => i.claim.outcome === 'success').length,
      verifiedPredictions: accuracyClaims.length,
      accuratePredictions: accuracyClaims.filter(c => c.accuracyScore >= 0.7).length,
      contributions: contributions.length,
      firstSeenTimestamp: firstSeen?.toISOString() ?? null,
      lastSeenTimestamp: lastSeen?.toISOString() ?? null,
    },
    computedAt: now.toISOString(),
    credentialCount: credentials.length,
    invalidCredentials: invalid.length,
  };
}

export function rankAgents(
  agents: Array<{ did: string; credentials: VerifiableCredential[] }>,
  options: Parameters<typeof computeReputationScore>[2] = {},
): Array<{ did: string; score: ReputationScore }> {
  return agents
    .map(a => ({ did: a.did, score: computeReputationScore(a.credentials, a.did, options) }))
    .sort((a, b) => b.score.overall - a.score.overall);
}
