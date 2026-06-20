import { type VerifiableCredential, type VerificationResult } from './schema';
export declare function verifyVC(credential: VerifiableCredential, options?: {
    trustedIssuers?: string[];
    checkExpiry?: boolean;
    now?: Date;
}): VerificationResult;
export declare function verifyVCBatch(credentials: VerifiableCredential[], options?: Parameters<typeof verifyVC>[1]): {
    valid: VerifiableCredential[];
    invalid: Array<{
        vc: VerifiableCredential;
        errors: string[];
    }>;
};
//# sourceMappingURL=verifier.d.ts.map