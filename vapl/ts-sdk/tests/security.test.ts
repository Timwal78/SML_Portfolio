import { describe, it, expect } from 'vitest';
import { generateSoul } from '../src/identity/soul';
import { issueInteractionVC } from '../src/credentials/issuer';
import { verifyVC } from '../src/credentials/verifier';

const ts = () => new Date().toISOString();
const baseInteraction = { type: 'CouncilVerdict' as const, resource: '/api/council', timestamp: '', outcome: 'success' as const };

describe('Security: Forgery Prevention', () => {
  it('cannot forge with attacker key', () => {
    const issuer = generateSoul();
    const attacker = generateSoul();
    const subject = generateSoul();
    const real = issueInteractionVC(issuer, subject.did, { ...baseInteraction, timestamp: ts() });
    const fake = issueInteractionVC(attacker, subject.did, { ...baseInteraction, timestamp: ts() });
    const forged = { ...real, proof: fake.proof };
    const result = verifyVC(forged, { trustedIssuers: [issuer.did] });
    expect(result.valid).toBe(false);
  });

  it('cannot swap subject DID', () => {
    const issuer = generateSoul();
    const legit = generateSoul();
    const imposter = generateSoul();
    const vc = issueInteractionVC(issuer, legit.did, { ...baseInteraction, timestamp: ts() });
    const swapped = { ...vc, credentialSubject: { ...vc.credentialSubject, id: imposter.did } };
    expect(verifyVC(swapped).valid).toBe(false);
  });

  it('cannot upgrade outcome from failure to success', () => {
    const issuer = generateSoul();
    const subject = generateSoul();
    const vc = issueInteractionVC(issuer, subject.did, { ...baseInteraction, timestamp: ts(), outcome: 'failure' });
    const upgraded = {
      ...vc,
      credentialSubject: {
        ...vc.credentialSubject,
        interaction: { ...(vc.credentialSubject as Record<string, unknown>)['interaction'] as object, outcome: 'success' },
      },
    };
    expect(verifyVC(upgraded as typeof vc).valid).toBe(false);
  });

  it('rejects all-zero proof value', () => {
    const issuer = generateSoul();
    const vc = issueInteractionVC(issuer, generateSoul().did, { ...baseInteraction, timestamp: ts() });
    const zeroed = { ...vc, proof: { ...vc.proof, proofValue: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } };
    expect(verifyVC(zeroed).valid).toBe(false);
  });

  it('rejects did:web issuer', () => {
    const issuer = generateSoul();
    const vc = issueInteractionVC(issuer, generateSoul().did, { ...baseInteraction, timestamp: ts() });
    const webIssuer = { ...vc, issuer: 'did:web:evil.example.com' };
    expect(verifyVC(webIssuer).valid).toBe(false);
  });

  it('rejects modified validUntil', () => {
    const issuer = generateSoul();
    const vc = issueInteractionVC(issuer, generateSoul().did, { ...baseInteraction, timestamp: ts() });
    const extended = { ...vc, validUntil: '2099-01-01T00:00:00Z' };
    expect(verifyVC(extended).valid).toBe(false);
  });

  it('rejects verification method not matching issuer', () => {
    const issuer = generateSoul();
    const other = generateSoul();
    const vc = issueInteractionVC(issuer, generateSoul().did, { ...baseInteraction, timestamp: ts() });
    const badVM = { ...vc, proof: { ...vc.proof, verificationMethod: other.verificationMethodId } };
    expect(verifyVC(badVM).valid).toBe(false);
  });
});
