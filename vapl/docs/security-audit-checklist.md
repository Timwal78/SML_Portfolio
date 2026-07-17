# VAPL Security Audit Checklist

Use this checklist when integrating VAPL into a production service or conducting a security review.

---

## 1. Cryptographic Primitives

- [ ] **Ed25519 only** — no RSA, no ECDSA, no DSA. VAPL uses `@noble/curves/ed25519` (TypeScript) and `cryptography` Ed25519 (Python). Confirm no other signing algorithms are accepted.
- [ ] **SHA-256 for message hashing** — verify that the canonical JSON is hashed with SHA-256 before signing, not passed raw to Ed25519.
- [ ] **No private key in transit** — the `privateKey` field of a `StoredSoul` must never appear in a log, HTTP header, API response, or error message.
- [ ] **Private key storage** — soul JSON files must be chmod 600 and owned by the service user. On Render/k8s, use mounted secrets, not environment variables.
- [ ] **Key rotation plan exists** — confirm there is a documented procedure for rotating the service soul if the private key is suspected compromised.

---

## 2. Canonical JSON Correctness

- [ ] **Proof field excluded** — the `proof` object is stripped before serialization. Confirm by unit test: sign a VC, then verify that `canonicalJson(vcWithProof) !== canonicalJson(vcWithoutProof)`.
- [ ] **Recursive key sorting** — verify that nested objects (e.g. `credentialSubject.metadata`) also have their keys sorted. A bug here produces valid-looking but unverifiable VCs.
- [ ] **No whitespace** — canonical JSON must have no spaces or newlines. Verify with `assert '\n' not in canonical_json(obj)`.
- [ ] **Array order preserved** — arrays must NOT be sorted; only object keys are sorted.
- [ ] **Cross-platform parity** — run the canonical JSON test vectors (in `vapl/spec/`) through both the Python and TypeScript implementations and confirm identical output.

---

## 3. VC Verification (8-Stage Check)

For each stage, confirm the verifier returns a clear error on failure and does NOT silently pass:

- [ ] **Stage 1: Context** — reject VCs missing `https://www.w3.org/ns/credentials/v2`.
- [ ] **Stage 2: Type** — reject VCs missing `VerifiableCredential` in `type`.
- [ ] **Stage 3: Issuer presence** — reject VCs with empty or missing `issuer`.
- [ ] **Stage 4: Proof fields** — reject VCs with missing `proof.type`, `proof.created`, `proof.verificationMethod`, `proof.proofPurpose`, or `proof.proofValue`.
- [ ] **Stage 5: Trusted issuers** — when `trustedIssuers` is provided, reject VCs whose `issuer` is not in the list.
- [ ] **Stage 6: DID method** — reject any issuer that is not a `did:key:` DID.
- [ ] **Stage 7: Expiry** — reject VCs where `now < validFrom - 5min` or `now > validUntil + 5min`.
- [ ] **Stage 8: Signature** — reject VCs with invalid Ed25519 signature. Test with: truncated proofValue, all-zero proofValue, signature from wrong key, bit-flipped proofValue.

---

## 4. Replay Protection

- [ ] **Unique VC IDs** — every issued VC has a unique `id` (`urn:vapl:vc:<uuid4>`). Confirm ID generation uses a CSPRNG, not sequential integers.
- [ ] **Nonce per claim** — every interaction claim includes a `nonce` field (random hex). Confirm nonce uniqueness across a sample of 1000 issued VCs.
- [ ] **ID deduplication in wallet** — the reputation scorer deduplicates VCs by `id` before scoring. Verify that injecting 1000 copies of the same VC yields the same score as 1 copy.
- [ ] **Clock skew tolerance is bounded** — the ±5 minute tolerance is intentional. Do not increase it without considering replay window expansion.

---

## 5. Input Validation

- [ ] **DID format** — `did_to_public_key_bytes()` validates the multicodec prefix `[0xed, 0x01]` and rejects malformed DIDs.
- [ ] **proofValue base64url** — the verifier handles padding-stripped base64url. Confirm that a proofValue with standard base64 padding (`=`) is accepted (or clearly rejected with a useful error).
- [ ] **Metadata size limits** — unbounded `metadata` dicts can cause DoS via memory exhaustion. Enforce a max serialized size in your middleware (e.g. 4 KB).
- [ ] **interactionType enum** — verify that unknown interaction types are rejected by schema validation before a VC is issued.
- [ ] **JSON deserialization** — confirm that the VC parser rejects non-JSON input gracefully (no stack traces to the caller).

---

## 6. Transport Security

- [ ] **HTTPS only** — all endpoints that accept or return VAPL VCs must be served over TLS 1.2+. No plaintext HTTP in production.
- [ ] **X-VAPL-VC header size** — large metadata can inflate this header. Confirm your HTTP server handles headers up to 16 KB without truncation.
- [ ] **CORS policy** — if the VAPL registry is browser-accessible, confirm CORS is restricted to known origins.
- [ ] **Rate limiting on /aggregate** — the registry's POST /aggregate endpoint must be rate-limited to prevent wallet flooding. Recommended: 100 VCs/minute per IP.

---

## 7. Key Isolation

- [ ] **Per-service souls** — each deployed service (SqueezeOS, Crawltoll, Ghost Layer, 402Proof) has its own soul. No shared private keys between services.
- [ ] **No soul in container image** — confirm the Dockerfile does not COPY the soul file. Soul is injected at runtime via mounted secret or env-referenced file path.
- [ ] **Secrets in CI** — the soul file is never committed to git. Confirm with `git log --all -- '*.soul.json'` returning no results.
- [ ] **Least-privilege access** — the service user can read the soul file but not write other sensitive files. Confirm with `ls -la` on the soul file path.

---

## 8. Threat Model Coverage

Review `vapl/spec/threat-model.md` and confirm each threat is mitigated:

| Threat ID | Description | Mitigated? |
|-----------|-------------|------------|
| T1 | Forged interaction VC (wrong key) | ☐ |
| T2 | Replay attack (duplicate VC ID) | ☐ |
| T3 | Outcome upgrade (failed→success) | ☐ |
| T4 | Subject substitution | ☐ |
| T5 | Expired VC reuse | ☐ |
| T6 | Malicious issuer (non-did:key) | ☐ |
| T7 | Untrusted issuer bypass | ☐ |
| T8 | Clock skew exploit | ☐ |
| T9 | Canonical JSON collision | ☐ |
| T10 | Private key exfiltration | ☐ |
| T11 | Wallet flooding / DoS | ☐ |
| T12 | Metadata injection (XSS in downstream display) | ☐ |
| T13 | Registry impersonation | ☐ |
| T14 | Cross-agent soul reuse | ☐ |
| T15 | Reputation gaming via self-issued accuracy VCs | ☐ |

---

## 9. Test Coverage

- [ ] **Python coverage ≥ 90%** — run `pytest --cov=vapl --cov-report=term-missing` and confirm ≥ 90% on lines, functions, and statements.
- [ ] **TypeScript coverage ≥ 90%** — run `npx vitest run --coverage` and confirm thresholds in `vitest.config.ts` pass.
- [ ] **Security tests present** — both SDKs include a `test_security.py` / `security.test.ts` file covering forged key, subject swap, outcome upgrade, zero proofValue, did:web issuer, extended validity, empty proof, VM mismatch.
- [ ] **Cross-SDK compatibility** — issue a VC with the Python SDK; verify it with the TypeScript SDK, and vice versa. Both must pass.

---

## 10. Operational

- [ ] **Soul backup procedure** — the soul file is backed up securely. Loss of soul = loss of issuer identity = all previously issued VCs become unverifiable.
- [ ] **Incident response** — if a soul private key is compromised, the procedure is: (1) generate new soul, (2) re-issue all VCs, (3) announce old DID revocation via service manifest update.
- [ ] **Logging** — VC issuance and verification events are logged at INFO level. Private key material is never logged.
- [ ] **Dependency pinning** — `@noble/curves` and `@noble/hashes` versions are pinned in `package.json`. `cryptography` version is pinned in `pyproject.toml`. Confirm `pip-audit` and `npm audit` are clean.
- [ ] **Supply chain** — `@noble/curves` and `@noble/hashes` are maintained by Paul Miller (paulmillr) and are the de facto standard for browser-compatible Ed25519. Confirm you are using the upstream packages, not forks.

---

*Last reviewed: June 2026 | VAPL v1.0*
