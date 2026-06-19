import type { ProvenanceSoul } from '../types';
import { issueInteractionVC } from '../credentials/issuer';
import type { VerifiableCredential, InteractionType, OutcomeType } from '../credentials/schema';
import { bytesToBase64url } from '../identity/keypair';

export interface X402InteractionContext {
  type: InteractionType;
  resource: string;
  outcome: OutcomeType;
  paymentTxHash?: string;
  paymentAmount?: string;
  paymentCurrency?: string;
  outcomeHash?: string;
  verifiableAccuracy?: number;
}

export function issueX402InteractionVC(
  issuerSoul: ProvenanceSoul,
  agentDid: string,
  context: X402InteractionContext,
): VerifiableCredential {
  return issueInteractionVC(issuerSoul, agentDid, {
    type: context.type,
    resource: context.resource,
    timestamp: new Date().toISOString(),
    outcome: context.outcome,
    ...(context.paymentTxHash && { paymentTxHash: context.paymentTxHash }),
    ...(context.paymentAmount && { paymentAmount: context.paymentAmount }),
    ...(context.paymentCurrency && { paymentCurrency: context.paymentCurrency }),
    ...(context.outcomeHash && { outcomeHash: context.outcomeHash }),
    ...(context.verifiableAccuracy !== undefined && { verifiableAccuracy: context.verifiableAccuracy }),
  });
}

export interface VerifiablePresentation {
  '@context': string[];
  type: string[];
  holder: string;
  verifiableCredential: VerifiableCredential[];
  challenge: string;
  domain: string;
  presentedAt: string;
}

export function createPresentation(
  holderDid: string,
  credentials: VerifiableCredential[],
  challenge: string,
  domain: string,
): VerifiablePresentation {
  return {
    '@context': [
      'https://www.w3.org/ns/credentials/v2',
      'https://vapl.scriptmasterlabs.com/v1/context.jsonld',
    ],
    type: ['VerifiablePresentation'],
    holder: holderDid,
    verifiableCredential: credentials,
    challenge,
    domain,
    presentedAt: new Date().toISOString(),
  };
}

export function vaplResponseHeaders(vc: VerifiableCredential): Record<string, string> {
  return {
    'X-VAPL-VC': JSON.stringify(vc),
    'X-VAPL-Issuer': vc.issuer,
    'X-VAPL-VC-ID': vc.id,
  };
}

export function parseVaplHeaders(headers: Record<string, string>): VerifiableCredential | null {
  const raw = headers['x-vapl-vc'] ?? headers['X-VAPL-VC'];
  if (!raw) return null;
  try {
    return JSON.parse(raw) as VerifiableCredential;
  } catch {
    return null;
  }
}
