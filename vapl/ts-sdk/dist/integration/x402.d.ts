import type { ProvenanceSoul } from '../types';
import type { VerifiableCredential, InteractionType, OutcomeType } from '../credentials/schema';
export interface X402InteractionContext {
    type: InteractionType;
    resource: string;
    outcome: OutcomeType;
    paymentTxHash?: string;
    paymentAmount?: string;
    paymentCurrency?: string;
    outcomeHash?: string;
    verifiableAccuracy?: number;
}
export declare function issueX402InteractionVC(issuerSoul: ProvenanceSoul, agentDid: string, context: X402InteractionContext): VerifiableCredential;
export interface VerifiablePresentation {
    '@context': string[];
    type: string[];
    holder: string;
    verifiableCredential: VerifiableCredential[];
    challenge: string;
    domain: string;
    presentedAt: string;
}
export declare function createPresentation(holderDid: string, credentials: VerifiableCredential[], challenge: string, domain: string): VerifiablePresentation;
export declare function vaplResponseHeaders(vc: VerifiableCredential): Record<string, string>;
export declare function parseVaplHeaders(headers: Record<string, string>): VerifiableCredential | null;
//# sourceMappingURL=x402.d.ts.map