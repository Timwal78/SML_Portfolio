import type { VerifiableCredential } from '../credentials/schema';
export interface ReputationWeights {
    accuracy: number;
    reliability: number;
    contribution: number;
    tenure: number;
}
export interface ReputationScore {
    overall: number;
    components: {
        accuracy: number;
        reliability: number;
        contribution: number;
        tenure: number;
    };
    evidence: {
        totalInteractions: number;
        successfulInteractions: number;
        verifiedPredictions: number;
        accuratePredictions: number;
        contributions: number;
        firstSeenTimestamp: string | null;
        lastSeenTimestamp: string | null;
    };
    computedAt: string;
    credentialCount: number;
    invalidCredentials: number;
}
export declare function computeReputationScore(credentials: VerifiableCredential[], subjectDid: string, options?: {
    weights?: Partial<ReputationWeights>;
    trustedIssuers?: string[];
    decayHalfLifeDays?: number;
    now?: Date;
}): ReputationScore;
export declare function rankAgents(agents: Array<{
    did: string;
    credentials: VerifiableCredential[];
}>, options?: Parameters<typeof computeReputationScore>[2]): Array<{
    did: string;
    score: ReputationScore;
}>;
//# sourceMappingURL=scorer.d.ts.map