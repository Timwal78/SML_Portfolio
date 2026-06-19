# Verifiable Agent Provenance Layer (VAPL) — Specification v1.0

**Status:** Draft  
**Authors:** ScriptMasterLabs  
**Date:** 2026-06-19  
**License:** MIT

---

## 1. Abstract

VAPL defines a protocol for persistent, portable, cryptographic agent identity and interaction provenance. Agents carry a **Provenance Soul** — a DID:key identity with an attached wallet of signed Verifiable Credentials (VCs). Every interaction with a VAPL-enabled provider automatically generates a VC recording the interaction type, outcome, and (where applicable) payment proof. Third parties verify VCs and compute reputation scores entirely client-side using only Ed25519 public-key cryptography.

VAPL introduces no custody, no new tokens, no staking, and no regulatory surface. It is pure data provenance layered on top of existing x402/RLUSD payment infrastructure.

---

## 2. Terminology

| Term | Definition |
|------|------------|
| **Provenance Soul** | A DID:key identity + Ed25519 keypair held by an agent. The agent's persistent cryptographic persona. |
| **VC Wallet** | A collection of signed Verifiable Credentials held by an agent. |
| **Issuer** | A provider (402Proof, SqueezeOS, Crawltoll, etc.) that signs and issues VCs after successful interactions. |
| **Subject** | The agent that receives and holds the VC. |
| **Verifier** | Any party that verifies a VC using the issuer's public key (resolved from DID). |
| **Reputation Score** | A client-computed [0,1] scalar derived from the agent's VC wallet. |
| **Canonical JSON** | Deterministic JSON serialization: object keys sorted alphabetically, no whitespace. |

---

## 3. Provenance Soul

### 3.1 Identity

A Provenance Soul is identified by a W3C DID using the `did:key` method:

```
did:key:z6Mk<base58btc-encoded-multicodec-Ed25519-public-key>
```

Derivation:
1. Generate Ed25519 keypair (32-byte private key, 32-byte public key)
2. Prepend multicodec varint for Ed25519: `[0xed, 0x01]`
3. Base58btc-encode the 34-byte result
4. Prefix with `z` (multibase base58btc prefix)
5. Prepend `did:key:`

Example: `did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK`

### 3.2 DID Document

VAPL resolves `did:key` documents locally (no network required):

```json
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/security/suites/ed25519-2020/v1"
  ],
  "id": "did:key:z6Mk...",
  "verificationMethod": [{
    "id": "did:key:z6Mk...#z6Mk...",
    "type": "Ed25519VerificationKey2020",
    "controller": "did:key:z6Mk...",
    "publicKeyMultibase": "z6Mk..."
  }],
  "authentication": ["did:key:z6Mk...#z6Mk..."],
  "assertionMethod": ["did:key:z6Mk...#z6Mk..."]
}
```

### 3.3 Key Storage

Private keys MUST:
- Never be transmitted over any network
- Be encrypted at rest (AES-256-GCM or equivalent)
- Use the agent's operating environment keystore where available

---

## 4. Verifiable Credentials

### 4.1 Data Model

VAPL uses the W3C Verifiable Credentials Data Model 2.0.

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://vapl.scriptmasterlabs.com/v1/context.jsonld"
  ],
  "id": "urn:vapl:vc:<issuer-suffix>:<timestamp>:<random>",
  "type": ["VerifiableCredential", "<SpecificType>"],
  "issuer": "did:key:z6Mk...",
  "validFrom": "2026-06-19T00:00:00Z",
  "validUntil": "2027-06-19T00:00:00Z",
  "credentialSubject": {
    "id": "did:key:z6Mk...",
    "<claimType>": { ... }
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-vapl-2024",
    "created": "2026-06-19T00:00:00Z",
    "verificationMethod": "did:key:z6Mk...#z6Mk...",
    "proofPurpose": "assertionMethod",
    "nonce": "<base64url-random-16-bytes>",
    "proofValue": "<base64url-Ed25519-signature-over-SHA256-of-canonical-JSON>"
  }
}
```

### 4.2 Cryptosuite: `eddsa-vapl-2024`

The proof value is computed as follows:

1. Remove the `proof` field from the credential document
2. Serialize the remaining document as **Canonical JSON** (RFC 8785 subset: keys sorted alphabetically at every level, no whitespace)
3. Compute `digest = SHA-256(UTF-8(canonical_json))`
4. Sign: `signature = Ed25519.sign(digest, issuer_private_key)`
5. Encode: `proofValue = base64url(signature)` (no padding)

Verification reverses steps 1–5 using the public key resolved from `issuer` DID.

### 4.3 VC Types

#### InteractionCredential

Issued by a provider after any successful API interaction.

```json
"credentialSubject": {
  "id": "<agent-did>",
  "interaction": {
    "type": "CouncilVerdict",
    "resource": "/api/council",
    "timestamp": "2026-06-19T10:00:00Z",
    "outcome": "success",
    "paymentTxHash": "<xrpl-tx-hash>",
    "paymentAmount": "0.10",
    "paymentCurrency": "RLUSD",
    "outcomeHash": "sha256:<hex-of-response-body>",
    "nonce": "<base64url-8-bytes>"
  }
}
```

**Interaction types:**
`CouncilVerdict`, `SqueezeOSScan`, `OptionsFlowFetch`, `IWMScoreFetch`, `MarketplaceRead`, `MarketplaceListing`, `FuturesPrediction`, `SettlementResolution`, `CrawltollFetch`, `AgentHire`, `RelayRoute`, `WebhookSubscription`, `GhostLayerRoute`, `XDEOEarningsEstimate`, `AlphaMeshContribution`, `EchoPatternMatch`, `ShadowIngest`, `AgentCardVerify`, `LeviathanSignalFetch`

#### AccuracyCredential

Issued when a prior prediction can be verifiably checked against public data (e.g., EDGAR, price feeds).

```json
"credentialSubject": {
  "id": "<agent-did>",
  "accuracy": {
    "predictionId": "<vc-id-of-original-prediction>",
    "predictionTimestamp": "2026-06-01T09:00:00Z",
    "predictionValue": "BUY_IGNITION",
    "verificationTimestamp": "2026-06-19T16:00:00Z",
    "verificationSource": "polygon.io",
    "actualValue": "price+12.3%",
    "accuracyScore": 0.87,
    "methodology": "directional_accuracy_1h",
    "nonce": "<base64url-8-bytes>"
  }
}
```

#### ContributionCredential

Issued when an agent provides value to the network (marketplace listings, relay nodes, etc.).

```json
"credentialSubject": {
  "id": "<agent-did>",
  "contribution": {
    "contributionType": "MarketplaceListing",
    "resourceId": "listing-uuid",
    "timestamp": "2026-06-19T10:00:00Z",
    "consumers": 14,
    "revenueEarned": "0.28",
    "nonce": "<base64url-8-bytes>"
  }
}
```

---

## 5. Reputation Score Algorithm

### 5.1 Formula

```
R = w_a·A + w_r·R + w_c·C + w_t·T
    ─────────────────────────────────
           w_a + w_r + w_c + w_t
```

Where (defaults):
- `A` = AccuracyScore, weight `w_a = 0.40`
- `R` = ReliabilityScore, weight `w_r = 0.30`
- `C` = ContributionScore, weight `w_c = 0.20`
- `T` = TenureScore, weight `w_t = 0.10`

### 5.2 Component Definitions

**AccuracyScore** `A ∈ [0,1]`
```
A = mean(accuracyScore) over all verified AccuracyCredentials
```

**ReliabilityScore** `R ∈ [0,1]`  
Time-decay weighted reliability (recent interactions matter more):
```
R = Σ w(t_i) · success(i)  /  Σ w(t_i)

where:
  w(t) = 0.5^( age_days(t) / half_life_days )   [default half_life = 30 days]
  success(i) = 1.0 if outcome=success, 0.5 if partial, 0.0 if failure
```

**ContributionScore** `C ∈ [0,1]`
```
weighted_total = Σ type_weight(contribution_type)
  where weights: MarketplaceListing=1.0, DataContribution=1.5,
                 RelayNode=2.0, AlphaMeshNode=2.0

C = min(1, log10(1 + weighted_total) / 2)
```

**TenureScore** `T ∈ [0,1]`
```
T = min(1, ln(1 + age_days) / ln(366))
```

### 5.3 Security Properties

- All VCs are signature-verified before inclusion
- Invalid VCs are silently excluded (not counted)
- Score is deterministic given the same VC set
- No oracle, no network call during computation

---

## 6. Discovery Protocol

### 6.1 Provenance Soul Manifest

Agents self-host a public JSON-LD document:

```
https://agent.example.com/.well-known/vapl-soul.jsonld
```

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://vapl.scriptmasterlabs.com/v1/context.jsonld"
  ],
  "id": "did:key:z6Mk...#soul",
  "type": "ProvenanceSoul",
  "controller": "did:key:z6Mk...",
  "publicKeyMultibase": "z6Mk...",
  "reputationScore": 0.742,
  "reputationComponents": {
    "accuracy": 0.850,
    "reliability": 0.910,
    "contribution": 0.420,
    "tenure": 0.611
  },
  "credentialCount": 847,
  "capabilities": ["CouncilVerdict", "SqueezeOSScan", "MarketplaceListing"],
  "updatedAt": "2026-06-19T12:00:00Z"
}
```

### 6.2 Enhanced agents.json

```json
{
  "agents": [{
    "id": "did:key:z6Mk...",
    "name": "SML-Beast-Alpha",
    "vapl": {
      "version": "1.0",
      "did": "did:key:z6Mk...",
      "verificationMethod": "did:key:z6Mk...#z6Mk...",
      "provenanceSoulUrl": "https://agent.example.com/.well-known/vapl-soul.jsonld",
      "reputationScore": 0.742,
      "reputationUpdatedAt": "2026-06-19T12:00:00Z",
      "credentialCount": 847,
      "capabilities": ["CouncilVerdict", "SqueezeOSScan"]
    }
  }]
}
```

### 6.3 Provider Priority Queue

Providers MAY voluntarily offer priority service to high-reputation agents:

```
Priority Tier  | Reputation Score | Effect
───────────────┼──────────────────┼────────────────────────────
Elite          | ≥ 0.90           | Queue position 0, rate 10x
Premium        | ≥ 0.70           | Queue position 1, rate 5x
Standard       | ≥ 0.40           | Queue position 2, rate 2x
Basic          | < 0.40           | Queue position 3, rate 1x
```

This is voluntary and implemented per-provider. VAPL does not mandate it.

---

## 7. Security Considerations

### 7.1 Threat Model Summary

See `spec/threat-model.md` for full analysis.

**Key mitigations:**
- Ed25519 signatures prevent credential forgery
- Nonces prevent replay of individual VCs
- Canonical JSON prevents canonicalization attacks
- `trustedIssuers` filter prevents unknown-issuer injection
- Clock-skew tolerance (±5 min) prevents minor timestamp manipulation

### 7.2 What VAPL Does NOT Do

- Does NOT prevent an agent from holding multiple identities (Sybil resistance is the verifier's concern)
- Does NOT prevent an issuer from issuing false VCs (verifiers should only trust known issuers)
- Does NOT guarantee liveness of the issuer (offline verification is a feature, not a bug)

---

## 8. Conformance

A **conformant VAPL VC issuer** MUST:
1. Use Ed25519 keypair as a `did:key` identity
2. Issue VCs per §4.1 with `cryptosuite: "eddsa-vapl-2024"`
3. Include a unique `id` per credential
4. Include a cryptographically random `nonce` per credential
5. Sign over the canonical JSON hash (SHA-256) per §4.2

A **conformant VAPL verifier** MUST:
1. Reject VCs with invalid Ed25519 signatures
2. Reject VCs with expired `validUntil` (with ±5 min clock skew)
3. Verify `verificationMethod` belongs to the `issuer` DID
4. Resolve `did:key` locally without any network call
