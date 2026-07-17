import { describe, it, expect } from 'vitest';
import { generateSoul } from '../src/identity/soul';
import { issueInteractionVC, issueAccuracyVC } from '../src/credentials/issuer';
import { verifyVC, verifyVCBatch } from '../src/credentials/verifier';

const ts = () => new Date().toISOString();

describe('issueInteractionVC', () => {
  it('issues a valid credential', () => {
    const issuer = generateSoul();
    const subject = generateSoul();
    const vc = issueInteractionVC(issuer, subject.did, {
      type: 'CouncilVerdict', resource: '/api/council', timestamp: ts(), outcome: 'success',
    });
    expect(vc.issuer).toBe(issuer.did);
    expect(vc.credentialSubject.id).toBe(subject.did);
    expect(vc.proof.cryptosuite).toBe('eddsa-vapl-2024');
    expect(vc.type).toContain('InteractionCredential');
  });

  it('generates unique IDs per credential', () => {
    const issuer = generateSoul();
    const s = generateSoul();
    const v1 = issueInteractionVC(issuer, s.did, { type: 'CouncilVerdict', resource: '/', timestamp: ts(), outcome: 'success' });
    const v2 = issueInteractionVC(issuer, s.did, { type: 'CouncilVerdict', resource: '/', timestamp: ts(), outcome: 'success' });
    expect(v1.id).not.toBe(v2.id);
  });
});

describe('verifyVC', () => {
  it('verifies a valid credential', () => {
    const issuer = generateSoul();
    const subject = generateSoul();
    const vc = issueInteractionVC(issuer, subject.did, { type: 'CouncilVerdict', resource: '/', timestamp: ts(), outcome: 'success' });
    const result = verifyVC(vc, { trustedIssuers: [issuer.did] });
    expect(result.valid).toBe(true);
    expect(result.issuerDid).toBe(issuer.did);
    expect(result.subjectDid).toBe(subject.did);
  });

  it('rejects tampered outcome', () => {
    const issuer = generateSoul();
    const subject = generateSoul();
    const vc = issueInteractionVC(issuer, subject.did, { type: 'CouncilVerdict', resource: '/', timestamp: ts(), outcome: 'success' });
    (vc.credentialSubject as Record<string, unknown>)['interaction'] =
      { ...(vc.credentialSubject as Record<string, unknown>)['interaction'] as object, outcome: 'failure' };
    const result = verifyVC(vc);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('tampered'))).toBe(true);
  });

  it('rejects untrusted issuer', () => {
    const issuer = generateSoul();
    const other = generateSoul();
    const subject = generateSoul();
    const vc = issueInteractionVC(issuer, subject.did, { type: 'CouncilVerdict', resource: '/', timestamp: ts(), outcome: 'success' });
    const result = verifyVC(vc, { trustedIssuers: [other.did] });
    expect(result.valid).toBe(false);
  });

  it('rejects missing proof', () => {
    const issuer = generateSoul();
    const vc = issueInteractionVC(issuer, generateSoul().did, { type: 'CouncilVerdict', resource: '/', timestamp: ts(), outcome: 'success' });
    delete (vc as Partial<typeof vc>).proof;
    const result = verifyVC(vc as typeof vc);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('proof'))).toBe(true);
  });

  it('batch verifies mixed valid/invalid', () => {
    const issuer = generateSoul();
    const subject = generateSoul();
    const good = issueInteractionVC(issuer, subject.did, { type: 'CouncilVerdict', resource: '/', timestamp: ts(), outcome: 'success' });
    const bad = issueInteractionVC(issuer, subject.did, { type: 'SqueezeOSScan', resource: '/scan', timestamp: ts(), outcome: 'success' });
    (bad.credentialSubject as Record<string, unknown>)['interaction'] =
      { ...(bad.credentialSubject as Record<string, unknown>)['interaction'] as object, outcome: 'failure' };
    const { valid, invalid } = verifyVCBatch([good, bad]);
    expect(valid).toHaveLength(1);
    expect(invalid).toHaveLength(1);
  });
});
