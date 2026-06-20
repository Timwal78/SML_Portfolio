export interface Keypair {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
}
export declare function generateKeypair(): Keypair;
export declare function sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array;
export declare function verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean;
export declare function bytesToBase64url(bytes: Uint8Array): string;
export declare function base64urlToBytes(base64url: string): Uint8Array;
//# sourceMappingURL=keypair.d.ts.map