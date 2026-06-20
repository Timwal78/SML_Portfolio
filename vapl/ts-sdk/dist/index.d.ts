export { generateSoul, exportSoul, loadSoul } from './identity/soul';
export { publicKeyToDid, didToPublicKey, resolveDid } from './identity/did';
export { generateKeypair, sign, verify, bytesToBase64url, base64urlToBytes } from './identity/keypair';
export { base58btcEncode, base58btcDecode } from './identity/encoding';
export { issueVC, issueInteractionVC, issueAccuracyVC, issueContributionVC } from './credentials/issuer';
export { verifyVC, verifyVCBatch } from './credentials/verifier';
export { computeReputationScore, rankAgents } from './reputation/scorer';
export { generateProvenanceSoulManifest, matchProviders } from './discovery/manifest';
export { issueX402InteractionVC, createPresentation, vaplResponseHeaders, parseVaplHeaders, } from './integration/x402';
export type { ProvenanceSoul, StoredSoul } from './types';
export type { VerifiableCredential, DataIntegrityProof, VerificationResult, InteractionClaim, AccuracyClaim, ContributionClaim, InteractionType, OutcomeType, } from './credentials/schema';
export type { ReputationScore, ReputationWeights } from './reputation/scorer';
export type { ProvenanceSoulManifest } from './discovery/manifest';
export type { X402InteractionContext, VerifiablePresentation, } from './integration/x402';
//# sourceMappingURL=index.d.ts.map