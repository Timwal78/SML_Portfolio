export declare const VAPL_CONTEXT = "https://vapl.scriptmasterlabs.com/v1/context.jsonld";
export declare const VC_CONTEXT_V2 = "https://www.w3.org/ns/credentials/v2";
export type InteractionType = 'LeviathanSignalFetch' | 'CouncilVerdict' | 'SqueezeOSScan' | 'OptionsFlowFetch' | 'IWMScoreFetch' | 'MarketplaceRead' | 'MarketplaceListing' | 'FuturesPrediction' | 'SettlementResolution' | 'CrawltollFetch' | 'AgentHire' | 'RelayRoute' | 'WebhookSubscription' | 'GhostLayerRoute' | 'XDEOEarningsEstimate' | 'AlphaMeshContribution' | 'EchoPatternMatch' | 'ShadowIngest' | 'AgentCardVerify';
export type OutcomeType = 'success' | 'failure' | 'partial';
export interface InteractionClaim {
    type: InteractionType;
    resource: string;
    timestamp: string;
    outcome: OutcomeType;
    nonce: string;
    paymentTxHash?: string;
    paymentAmount?: string;
    paymentCurrency?: string;
    outcomeHash?: string;
    verifiableAccuracy?: number;
}
export interface AccuracyClaim {
    predictionId: string;
    predictionTimestamp: string;
    predictionValue: string;
    verificationTimestamp: string;
    verificationSource: string;
    actualValue: string;
    accuracyScore: number;
    methodology: string;
    nonce: string;
}
export interface ContributionClaim {
    contributionType: 'MarketplaceListing' | 'DataContribution' | 'RelayNode' | 'AlphaMeshNode';
    resourceId: string;
    timestamp: string;
    nonce: string;
    consumers?: number;
    revenueEarned?: string;
}
export type CredentialSubject = {
    id: string;
} & ({
    interaction: InteractionClaim;
} | {
    accuracy: AccuracyClaim;
} | {
    contribution: ContributionClaim;
});
export interface DataIntegrityProof {
    type: 'DataIntegrityProof';
    cryptosuite: 'eddsa-vapl-2024';
    created: string;
    verificationMethod: string;
    proofPurpose: 'assertionMethod';
    nonce: string;
    proofValue: string;
}
export interface VerifiableCredential {
    '@context': string[];
    id: string;
    type: string[];
    issuer: string;
    validFrom: string;
    validUntil?: string;
    credentialSubject: CredentialSubject;
    proof: DataIntegrityProof;
}
export interface VerificationResult {
    valid: boolean;
    credential?: VerifiableCredential;
    errors: string[];
    warnings: string[];
    issuerDid?: string;
    subjectDid?: string;
    verifiedAt: string;
}
//# sourceMappingURL=schema.d.ts.map