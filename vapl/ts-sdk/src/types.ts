export interface ProvenanceSoul {
  did: string;
  verificationMethodId: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  publicKeyMultibase: string;
  createdAt: string;
}

export interface StoredSoul {
  did: string;
  verificationMethodId: string;
  publicKeyMultibase: string;
  privateKeyBase64url: string;
  publicKeyBase64url: string;
  createdAt: string;
}
