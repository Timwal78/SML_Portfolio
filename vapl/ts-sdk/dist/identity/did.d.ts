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
export declare function publicKeyToDid(publicKey: Uint8Array): string;
export declare function didToPublicKey(did: string): Uint8Array;
export declare function resolveDid(did: string): ResolvedDID;
//# sourceMappingURL=did.d.ts.map