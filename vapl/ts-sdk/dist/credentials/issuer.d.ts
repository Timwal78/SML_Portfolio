import type { ProvenanceSoul } from '../types';
import { type VerifiableCredential, type InteractionClaim, type AccuracyClaim, type ContributionClaim } from './schema';
export declare function issueVC(soul: ProvenanceSoul, subjectDid: string, credentialType: string, claim: {
    interaction: InteractionClaim;
} | {
    accuracy: AccuracyClaim;
} | {
    contribution: ContributionClaim;
}, validitySeconds?: number): VerifiableCredential;
export declare function issueInteractionVC(soul: ProvenanceSoul, subjectDid: string, interaction: Omit<InteractionClaim, 'nonce'>): VerifiableCredential;
export declare function issueAccuracyVC(soul: ProvenanceSoul, subjectDid: string, accuracy: Omit<AccuracyClaim, 'nonce'>): VerifiableCredential;
export declare function issueContributionVC(soul: ProvenanceSoul, subjectDid: string, contribution: Omit<ContributionClaim, 'nonce'>): VerifiableCredential;
//# sourceMappingURL=issuer.d.ts.map