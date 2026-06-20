import { sha256 } from '@noble/hashes/sha256';
import { verify, base64urlToBytes } from '../identity/keypair';
import { didToPublicKey } from '../identity/did';
import { VC_CONTEXT_V2, type VerifiableCredential, type VerificationResult } from './schema';

const CLOCK_SKEW_MS = 5 * 60 * 1000;

function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return '{' + keys.map(k => `${JSON.stringify(k)}:${canonicalJson((obj as Record<string, unknown>)[k])}`).join(',') + '}';
}

export function verifyVC(
  credential: VerifiableCredential,
  options: {
    trustedIssuers?: string[];
    checkExpiry?: boolean;
    now?: Date;
  } = {},
): VerificationResult {
  const now = options.now ?? new Date();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!credential['@context']?.includes(VC_CONTEXT_V2)) errors.push('Missing W3C VC v2 context');
  if (!credential.type?.includes('VerifiableCredential')) errors.push('Missing VerifiableCredential type');
  if (!credential.issuer) errors.push('Missing issuer');
  if (!credential.proof) errors.push('Missing proof');
  if (!credential.credentialSubject?.id) errors.push('Missing credentialSubject.id');

  if (errors.length > 0) return { valid: false, errors, warnings, verifiedAt: now.toISOString() };

  if (options.trustedIssuers && !options.trustedIssuers.includes(credential.issuer)) {
    errors.push(`Issuer ${credential.issuer} is not in trusted issuers list`);
  }

  if (!credential.issuer.startsWith('did:key:')) {
    errors.push('Issuer must be a did:key DID');
  }

  const proof = credential.proof;
  if (proof.type !== 'DataIntegrityProof') errors.push(`Unsupported proof type: ${proof.type}`);
  if (proof.cryptosuite !== 'eddsa-vapl-2024') errors.push(`Unsupported cryptosuite: ${proof.cryptosuite}`);
  if (proof.proofPurpose !== 'assertionMethod') errors.push(`Unexpected proofPurpose: ${proof.proofPurpose}`);
  if (!proof.verificationMethod.startsWith(credential.issuer)) {
    errors.push('Verification method does not match issuer DID');
  }

  if (errors.length > 0) return { valid: false, errors, warnings, verifiedAt: now.toISOString() };

  if (options.checkExpiry !== false) {
    const validFrom = new Date(credential.validFrom);
    if (validFrom.getTime() > now.getTime() + CLOCK_SKEW_MS) {
      errors.push(`Credential not yet valid (validFrom: ${credential.validFrom})`);
    }
    if (credential.validUntil) {
      const validUntil = new Date(credential.validUntil);
      if (validUntil.getTime() < now.getTime() - CLOCK_SKEW_MS) {
        errors.push(`Credential expired (validUntil: ${credential.validUntil})`);
      }
    }
  }

  if (errors.length > 0) return { valid: false, errors, warnings, verifiedAt: now.toISOString() };

  try {
    const publicKey = didToPublicKey(credential.issuer);
    const { proof: _proof, ...vcWithoutProof } = credential;
    const hash = sha256(new TextEncoder().encode(canonicalJson(vcWithoutProof)));
    const sig = base64urlToBytes(proof.proofValue);
    if (!verify(hash, sig, publicKey)) {
      errors.push('Invalid signature: credential has been tampered with');
    }
  } catch (e) {
    errors.push(`Signature verification error: ${e instanceof Error ? e.message : String(e)}`);
  }

  const valid = errors.length === 0;
  return {
    valid,
    ...(valid ? { credential } : {}),
    errors,
    warnings,
    issuerDid: credential.issuer,
    subjectDid: credential.credentialSubject.id,
    verifiedAt: now.toISOString(),
  };
}

export function verifyVCBatch(
  credentials: VerifiableCredential[],
  options: Parameters<typeof verifyVC>[1] = {},
): { valid: VerifiableCredential[]; invalid: Array<{ vc: VerifiableCredential; errors: string[] }> } {
  const valid: VerifiableCredential[] = [];
  const invalid: Array<{ vc: VerifiableCredential; errors: string[] }> = [];

  for (const vc of credentials) {
    const result = verifyVC(vc, options);
    if (result.valid && result.credential) {
      valid.push(result.credential);
    } else {
      invalid.push({ vc, errors: result.errors });
    }
  }

  return { valid, invalid };
}
