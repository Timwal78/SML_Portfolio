import { type ReputationScore } from '../reputation/scorer';
import type { VerifiableCredential } from '../credentials/schema';
export interface ProvenanceSoulManifest {
    '@context': string[];
    id: string;
    type: 'ProvenanceSoul';
    controller: string;
    publicKeyMultibase: string;
    reputationScore: number;
    reputationComponents: ReputationScore['components'];
    credentialCount: number;
    capabilities: string[];
    updatedAt: string;
}
export declare function generateProvenanceSoulManifest(did: string, publicKeyMultibase: string, credentials: VerifiableCredential[], capabilities?: string[], options?: {
    trustedIssuers?: string[];
}): ProvenanceSoulManifest;
export declare function matchProviders(providers: Array<{
    did: string;
    credentials: VerifiableCredential[];
    capabilities: string[];
    endpoint?: string;
}>, requiredCapability?: string, options?: {
    trustedIssuers?: string[];
}): Array<{
    did: string;
    endpoint?: string;
    capabilities: string[];
    reputationScore: ReputationScore;
}>;
//# sourceMappingURL=manifest.d.ts.map