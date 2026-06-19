import { sha256 } from '@noble/hashes/sha256';
import { sign, bytesToBase64url } from '../identity/keypair';
import type { ProvenanceSoul } from '../types';
import {
  VAPL_CONTEXT, VC_CONTEXT_V2,
  type VerifiableCredential, type DataIntegrityProof,
  type InteractionClaim, type AccuracyClaim, type ContributionClaim,
} from './schema';

function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return '{' + keys.map(k => `${JSON.stringify(k)}:${canonicalJson((obj as Record<string, unknown>)[k])}`).join(',') + '}';
}

function randomBase64url(bytes: number): string {
  const arr = new Uint8Array(bytes);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    const { randomFillSync } = require('crypto') as typeof import('crypto');
    randomFillSync(arr);
  }
  return bytesToBase64url(arr);
}

function generateCredentialId(issuerDid: string): string {
  return `urn:vapl:vc:${issuerDid.slice(-8)}:${Date.now()}:${randomBase64url(8)}`;
}

function hashDocument(doc: Omit<VerifiableCredential, 'proof'>): Uint8Array {
  return sha256(new TextEncoder().encode(canonicalJson(doc)));
}

export function issueVC(
  soul: ProvenanceSoul,
  subjectDid: string,
  credentialType: string,
  claim: { interaction: InteractionClaim } | { accuracy: AccuracyClaim } | { contribution: ContributionClaim },
  validitySeconds = 86400 * 365,
): VerifiableCredential {
  const now = new Date();
  const validFrom = now.toISOString();
  const validUntil = new Date(now.getTime() + validitySeconds * 1000).toISOString();

  const vcWithoutProof: Omit<VerifiableCredential, 'proof'> = {
    '@context': [VC_CONTEXT_V2, VAPL_CONTEXT],
    id: generateCredentialId(soul.did),
    type: ['VerifiableCredential', credentialType],
    issuer: soul.did,
    validFrom,
    validUntil,
    credentialSubject: { id: subjectDid, ...claim } as VerifiableCredential['credentialSubject'],
  };

  const hash = hashDocument(vcWithoutProof);
  const signature = sign(hash, soul.privateKey);

  const proof: DataIntegrityProof = {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-vapl-2024',
    created: now.toISOString(),
    verificationMethod: soul.verificationMethodId,
    proofPurpose: 'assertionMethod',
    nonce: randomBase64url(16),
    proofValue: bytesToBase64url(signature),
  };

  return { ...vcWithoutProof, proof };
}

export function issueInteractionVC(
  soul: ProvenanceSoul,
  subjectDid: string,
  interaction: Omit<InteractionClaim, 'nonce'>,
): VerifiableCredential {
  return issueVC(soul, subjectDid, 'InteractionCredential', {
    interaction: { ...interaction, nonce: randomBase64url(8) },
  });
}

export function issueAccuracyVC(
  soul: ProvenanceSoul,
  subjectDid: string,
  accuracy: Omit<AccuracyClaim, 'nonce'>,
): VerifiableCredential {
  return issueVC(soul, subjectDid, 'AccuracyCredential', {
    accuracy: { ...accuracy, nonce: randomBase64url(8) },
  });
}

export function issueContributionVC(
  soul: ProvenanceSoul,
  subjectDid: string,
  contribution: Omit<ContributionClaim, 'nonce'>,
): VerifiableCredential {
  return issueVC(soul, subjectDid, 'ContributionCredential', {
    contribution: { ...contribution, nonce: randomBase64url(8) },
  });
}
