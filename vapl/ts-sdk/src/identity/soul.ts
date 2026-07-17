import { generateKeypair, bytesToBase64url, base64urlToBytes } from './keypair';
import { publicKeyToDid, resolveDid } from './did';
import { base58btcEncode } from './encoding';
import type { ProvenanceSoul, StoredSoul } from '../types';

const ED25519_MULTICODEC = new Uint8Array([0xed, 0x01]);

export function generateSoul(): ProvenanceSoul {
  const { publicKey, privateKey } = generateKeypair();
  const did = publicKeyToDid(publicKey);
  const { verificationMethodId } = resolveDid(did);

  const prefixed = new Uint8Array(ED25519_MULTICODEC.length + publicKey.length);
  prefixed.set(ED25519_MULTICODEC);
  prefixed.set(publicKey, ED25519_MULTICODEC.length);
  const publicKeyMultibase = 'z' + base58btcEncode(prefixed);

  return {
    did,
    verificationMethodId,
    publicKey,
    privateKey,
    publicKeyMultibase,
    createdAt: new Date().toISOString(),
  };
}

export function exportSoul(soul: ProvenanceSoul): StoredSoul {
  return {
    did: soul.did,
    verificationMethodId: soul.verificationMethodId,
    publicKeyMultibase: soul.publicKeyMultibase,
    privateKeyBase64url: bytesToBase64url(soul.privateKey),
    publicKeyBase64url: bytesToBase64url(soul.publicKey),
    createdAt: soul.createdAt,
  };
}

export function loadSoul(stored: StoredSoul): ProvenanceSoul {
  return {
    did: stored.did,
    verificationMethodId: stored.verificationMethodId,
    publicKeyMultibase: stored.publicKeyMultibase,
    publicKey: base64urlToBytes(stored.publicKeyBase64url),
    privateKey: base64urlToBytes(stored.privateKeyBase64url),
    createdAt: stored.createdAt,
  };
}
