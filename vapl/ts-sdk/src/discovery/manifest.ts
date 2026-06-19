import { computeReputationScore, type ReputationScore } from '../reputation/scorer';
import type { VerifiableCredential } from '../credentials/schema';

export interface ProvenanceSoulManifest {
  '@context': string[];
  id: string;
  type: 'ProvenanceSoul';
  controller: string;
  publicKeyMultibase: string;
  reputationScore: number;
  reputationComponents: ReputationScore['components'];
  credentialCount: number;
  capabilities: string[];
  updatedAt: string;
}

export function generateProvenanceSoulManifest(
  did: string,
  publicKeyMultibase: string,
  credentials: VerifiableCredential[],
  capabilities: string[] = [],
  options: { trustedIssuers?: string[] } = {},
): ProvenanceSoulManifest {
  const score = computeReputationScore(credentials, did, { trustedIssuers: options.trustedIssuers });

  return {
    '@context': [
      'https://www.w3.org/ns/credentials/v2',
      'https://vapl.scriptmasterlabs.com/v1/context.jsonld',
    ],
    id: `${did}#soul`,
    type: 'ProvenanceSoul',
    controller: did,
    publicKeyMultibase,
    reputationScore: score.overall,
    reputationComponents: score.components,
    credentialCount: score.credentialCount,
    capabilities,
    updatedAt: new Date().toISOString(),
  };
}

export function matchProviders(
  providers: Array<{
    did: string;
    credentials: VerifiableCredential[];
    capabilities: string[];
    endpoint?: string;
  }>,
  requiredCapability?: string,
  options: { trustedIssuers?: string[] } = {},
): Array<{ did: string; endpoint?: string; capabilities: string[]; reputationScore: ReputationScore }> {
  const eligible = requiredCapability
    ? providers.filter(p => p.capabilities.includes(requiredCapability))
    : providers;

  return eligible
    .map(p => ({
      did: p.did,
      endpoint: p.endpoint,
      capabilities: p.capabilities,
      reputationScore: computeReputationScore(p.credentials, p.did, options),
    }))
    .sort((a, b) => b.reputationScore.overall - a.reputationScore.overall);
}
