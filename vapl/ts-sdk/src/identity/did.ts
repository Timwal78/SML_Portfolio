import { base58btcEncode, base58btcDecode } from './encoding';

const ED25519_MULTICODEC = new Uint8Array([0xed, 0x01]);

export interface DIDDocument {
  '@context': string[];
  id: string;
  verificationMethod: VerificationMethod[];
  authentication: string[];
  assertionMethod: string[];
  capabilityDelegation: string[];
  capabilityInvocation: string[];
}

export interface VerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyMultibase: string;
}

export interface ResolvedDID {
  did: string;
  document: DIDDocument;
  verificationMethodId: string;
  publicKey: Uint8Array;
}

export function publicKeyToDid(publicKey: Uint8Array): string {
  const prefixed = new Uint8Array(ED25519_MULTICODEC.length + publicKey.length);
  prefixed.set(ED25519_MULTICODEC);
  prefixed.set(publicKey, ED25519_MULTICODEC.length);
  return `did:key:z${base58btcEncode(prefixed)}`;
}

export function didToPublicKey(did: string): Uint8Array {
  if (!did.startsWith('did:key:z')) {
    throw new Error(`Invalid did:key format: ${did}`);
  }
  const multibaseKey = did.slice('did:key:'.length);
  const decoded = base58btcDecode(multibaseKey.slice(1));

  if (decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new Error('Expected Ed25519 multicodec prefix 0xed01');
  }
  return decoded.slice(2);
}

export function resolveDid(did: string): ResolvedDID {
  const publicKey = didToPublicKey(did);
  const keyId = did.slice('did:key:'.length);
  const vmId = `${did}#${keyId}`;

  const document: DIDDocument = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    id: did,
    verificationMethod: [{
      id: vmId,
      type: 'Ed25519VerificationKey2020',
      controller: did,
      publicKeyMultibase: keyId,
    }],
    authentication: [vmId],
    assertionMethod: [vmId],
    capabilityDelegation: [vmId],
    capabilityInvocation: [vmId],
  };

  return { did, document, verificationMethodId: vmId, publicKey };
}
