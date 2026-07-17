# VAPL Threat Model

## Scope

This document covers threats to the VAPL protocol, SDK implementations, and integrated systems (402Proof, SqueezeOS, Crawltoll, Ghost Layer).

---

## Threat Matrix

| ID | Threat | Severity | Mitigation | Status |
|----|--------|----------|------------|--------|
| T1 | Credential forgery (attacker signs fake VC) | Critical | Ed25519 signature over SHA-256 of canonical JSON; attacker cannot forge without private key | Mitigated |
| T2 | Replay attack (reuse captured VC) | High | Per-VC `nonce` + unique `id`; verifiers track seen nonces in sliding window | Mitigated |
| T3 | Canonicalization attack (reorder JSON to break sig) | High | Canonical JSON (alphabetical key sort, no whitespace) is deterministic; same input = same hash | Mitigated |
| T4 | Clock manipulation (fake timestamps) | Medium | ±5 min clock skew tolerance; `validFrom`/`validUntil` signed into VC body | Partially mitigated |
| T5 | Sybil attack (many fake identities) | Medium | Protocol-level: unmitigated (by design). Verifiers apply `trustedIssuers` allowlist | Acknowledged |
| T6 | Issuer compromise (provider key leak) | Critical | Key rotation via new DID; verifiers pin specific verification method IDs | Operational |
| T7 | Untrusted issuer injection | High | `trustedIssuers` parameter in `verifyVC()` restricts to known issuers | Mitigated |
| T8 | Private key exfiltration | Critical | Keys never transmitted; agent stores in encrypted keystore; no raw key serialization in logs | Implementation |
| T9 | Credential inflation (self-issue fake VCs) | High | Reputation only counts VCs from trusted issuers; self-issued VCs have no value without trusted issuer |	Mitigated |
| T10 | Side-channel (timing attack on verify) | Low | @noble/ed25519 uses constant-time operations; Python cryptography lib uses constant-time | Mitigated |
| T11 | JSON injection in claims | Medium | Canonical JSON serialization neutralizes injection; claims are typed, not eval'd | Mitigated |
| T12 | DID resolution MITM | Low | did:key resolves locally from the DID string itself; no network call | Mitigated |
| T13 | Proof stripping (remove proof field, re-add fake) | Critical | verifyVC() rejects missing proof; proof references verificationMethod which must match issuer | Mitigated |
| T14 | Context substitution (swap @context) | Medium | verifyVC() checks for required W3C VC v2 context; signature covers @context | Mitigated |
| T15 | Large VC wallet DoS | Low | SDK processes credentials individually; batch API streams results | Acknowledged |

---

## Attack Scenarios

### Scenario A: Credential Forgery

**Attacker goal:** Issue a fake `CouncilVerdict` VC claiming a successful interaction they never paid for.

**Steps an attacker might try:**
1. Copy a real VC from a network response
2. Modify `credentialSubject.interaction.outcome` from `failure` to `success`
3. Submit to a verifier

**Why it fails:** The `proof.proofValue` is a signature over SHA-256(canonical_json_without_proof). Modifying any field changes the canonical JSON, invalidating the signature. The attacker cannot re-sign without the issuer's Ed25519 private key.

### Scenario B: VC Replay

**Attacker goal:** Reuse a captured VC to claim multiple interactions from one payment.

**Steps:** Capture `X-VAPL-VC` header from a provider response; replay it to a different verifier.

**Why it partially fails:** Each VC has a unique `id` (`urn:vapl:vc:...`). Stateful verifiers track seen IDs in a sliding window (e.g., 24 hours). Stateless verifiers cannot detect replay but the VC only proves "this interaction happened"; it doesn't grant access or authorization by itself.

**Residual risk:** Stateless verifiers see replayed VCs as valid. Recommendation: use VC IDs as idempotency keys in business logic.

### Scenario C: Sybil Reputation Farming

**Attacker goal:** Create 1000 fake agent DIDs, each with one VC, to aggregate reputation.

**Why it partially fails:** Reputation is per-DID, not aggregated across DIDs. A single agent with 1000 VCs outranks 1000 agents with 1 VC each. Verifiers set `trustedIssuers` to known providers — random agents cannot self-issue reputation.

**Residual risk:** An attacker controlling a provider-level key could spam VCs. Mitigated by: (a) providers rate-limit VC issuance, (b) verifiers can blacklist specific issuer DIDs.

---

## Security Checklist for Integrators

- [ ] Always pass `trustedIssuers` to `verifyVC()` — never trust all issuers
- [ ] Store issuer DIDs in config, not derived from VC fields
- [ ] Log all VC verifications with outcome for audit trail
- [ ] Rotate issuer keypair if compromise suspected; publish new DID
- [ ] Implement nonce tracking for replay protection in stateful systems
- [ ] Never log or transmit private key material
- [ ] Use `validityDurationSeconds` appropriate to the sensitivity of the claim
- [ ] Monitor for unusual spike in `invalidCredentials` count (may indicate active attack)
- [ ] Run `verifyVC()` server-side for access-control decisions; never trust client-side only

---

## Cryptographic Primitives

| Primitive | Choice | Rationale |
|-----------|--------|-----------|
| Signature | Ed25519 | Fast, 64-byte sig, constant-time, widely audited |
| Hash | SHA-256 | Pre-image resistant, collision resistant, standard |
| Encoding | Base64url | URL-safe, compact, no padding ambiguity |
| DID encoding | Base58btc (multibase `z`) | did:key standard |
| Key generation | CSPRNG (OS entropy) | crypto.getRandomValues / os.urandom |
