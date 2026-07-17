import { describe, it, expect } from 'vitest';
import { generateSoul, exportSoul, loadSoul } from '../src/identity/soul';
import { publicKeyToDid, didToPublicKey, resolveDid } from '../src/identity/did';
import { generateKeypair, sign, verify } from '../src/identity/keypair';

describe('generateSoul', () => {
  it('generates a valid did:key DID', () => {
    const soul = generateSoul();
    expect(soul.did).toMatch(/^did:key:z6Mk/);
    expect(soul.verificationMethodId).toBe(`${soul.did}#${soul.did.slice('did:key:'.length)}`);
  });

  it('generates unique DIDs', () => {
    const dids = [generateSoul(), generateSoul(), generateSoul()].map(s => s.did);
    expect(new Set(dids).size).toBe(3);
  });

  it('round-trips through export/load', () => {
    const soul = generateSoul();
    const loaded = loadSoul(exportSoul(soul));
    expect(loaded.did).toBe(soul.did);
    expect(loaded.verificationMethodId).toBe(soul.verificationMethodId);
    expect(loaded.publicKeyMultibase).toBe(soul.publicKeyMultibase);
  });
});

describe('DID operations', () => {
  it('converts public key to DID and back', () => {
    const { publicKey } = generateKeypair();
    const did = publicKeyToDid(publicKey);
    const recovered = didToPublicKey(did);
    expect(recovered).toEqual(publicKey);
  });

  it('resolves DID to document', () => {
    const soul = generateSoul();
    const resolved = resolveDid(soul.did);
    expect(resolved.did).toBe(soul.did);
    expect(resolved.document.assertionMethod).toContain(resolved.verificationMethodId);
    expect(resolved.document.authentication).toContain(resolved.verificationMethodId);
  });

  it('rejects non-did:key DIDs', () => {
    expect(() => didToPublicKey('did:web:example.com')).toThrow();
    expect(() => didToPublicKey('not-a-did')).toThrow();
  });
});

describe('Ed25519 cryptography', () => {
  it('sign/verify round-trip succeeds', () => {
    const { publicKey, privateKey } = generateKeypair();
    const msg = new TextEncoder().encode('hello world');
    const sig = sign(msg, privateKey);
    expect(verify(msg, sig, publicKey)).toBe(true);
  });

  it('rejects wrong key', () => {
    const kp1 = generateKeypair();
    const kp2 = generateKeypair();
    const msg = new TextEncoder().encode('hello');
    const sig = sign(msg, kp1.privateKey);
    expect(verify(msg, sig, kp2.publicKey)).toBe(false);
  });

  it('rejects tampered message', () => {
    const { publicKey, privateKey } = generateKeypair();
    const sig = sign(new TextEncoder().encode('original'), privateKey);
    expect(verify(new TextEncoder().encode('tampered'), sig, publicKey)).toBe(false);
  });

  it('rejects truncated signature', () => {
    const { publicKey, privateKey } = generateKeypair();
    const msg = new TextEncoder().encode('test');
    const sig = sign(msg, privateKey).slice(0, 32);
    expect(verify(msg, sig, publicKey)).toBe(false);
  });
});
