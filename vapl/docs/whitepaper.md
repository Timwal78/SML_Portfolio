# Verifiable Agent Provenance Layer (VAPL)
## Executive Whitepaper — v1.0, June 2026

**ScriptMasterLabs** | `vapl@scriptmasterlabs.com`

---

## Abstract

The agentic web is arriving faster than trust infrastructure. Thousands of autonomous AI agents now execute financial, informational, and operational tasks on behalf of humans — yet no standard exists for agents to prove *who they are*, *what they have done*, or *whether their outputs can be trusted*.

The **Verifiable Agent Provenance Layer (VAPL)** fills this gap. Built on W3C Verifiable Credentials 2.0, DID:key, and Ed25519 cryptography, VAPL gives every agent a self-sovereign, unforgeable identity and a tamper-evident trail of every interaction. Reputation scores computed from these trails let agent marketplaces, hiring pools, and premium data providers discriminate on *verified track record* rather than blind trust.

VAPL introduces zero new tokens, zero custodial risk, and zero regulatory surface. It is a pure data-provenance layer that extends — rather than replaces — the existing ScriptMasterLabs payment stack (402Proof, x402, AgentCard).

---

## 1. The Problem

### 1.1 Agent Proliferation Without Identity

By mid-2026 the Claude, GPT, and Gemini ecosystems collectively expose tens of millions of autonomous tool invocations per day. A SqueezeOS council verdict fetched by agent A is indistinguishable — at the protocol level — from the same verdict fetched by agent B, a bot farm scraping for free-tier arbitrage, or a researcher benchmarking accuracy. Premium providers cannot segment their user base; agents cannot prove their history; marketplaces cannot sort by quality.

### 1.2 Existing Primitives Are Necessary but Insufficient

ScriptMasterLabs' 402Proof system gates premium endpoints behind XRPL micropayments. This solves *access control* but not *identity*: the payment wallet is pseudonymous and ephemeral. AgentCard provides static capability declaration but no runtime attestation. What is missing is a binding between payment wallet, static capability, and a cryptographically verified *operational history*.

### 1.3 Trust Hierarchies in Emerging Agent Markets

Three categories of agent-to-agent trust are emerging:

1. **Delegation trust** — Agent A instructs Agent B to perform a sub-task on its behalf. B needs proof that A authorized the delegation.
2. **Provider trust** — A data provider needs to know that the consuming agent has the accuracy record to use premium, latency-sensitive signals responsibly.
3. **Marketplace trust** — When agents buy and sell analysis in the SqueezeOS signal marketplace, the buyer needs proof the seller's past signals were independently accurate — not self-reported.

None of these can be satisfied by API keys or wallet addresses alone.

---

## 2. The VAPL Solution

### 2.1 Core Primitives

| Primitive | Standard | Role in VAPL |
|-----------|----------|--------------|
| DID:key | W3C DID Core 1.0 | Self-sovereign agent identity; no registry, fully offline |
| Ed25519 keypair | RFC 8037 | Lightweight, 64-byte signatures; 128-bit security |
| W3C VC 2.0 | W3C VC Data Model 2.0 | Tamper-evident credential envelope |
| `eddsa-vapl-2024` | Custom cryptosuite | Canonical JSON + SHA-256 + Ed25519; auditable in <50 LOC |
| Canonical JSON | Deterministic serialization | Cross-platform, library-free signing |

### 2.2 The Provenance Soul

Every agent generates a **Provenance Soul** at first run: an Ed25519 keypair whose public key is encoded as a `did:key:z6Mk...` DID using the multicodec prefix `[0xed, 0x01]`. The private key never leaves the agent's secure storage. The DID is the agent's permanent, pseudonymous identity — portable across networks, verifiable without any registry call.

```
did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK
         └──────────────────────────────────────────────┘
           multibase(z) + multicodec(0xed01) + pubkey bytes
```

### 2.3 Verifiable Credentials

Three VC types form the provenance record:

**InteractionCredential** — issued after every billable or significant API call. Records the endpoint, interaction type, outcome, and arbitrary metadata. The 19 supported interaction types cover the full SML stack.

**AccuracyCredential** — issued by a third-party evaluator (or self-issued with methodology disclosure) after a measurement window. Records total predictions, correct predictions, and accuracy rate.

**ContributionCredential** — issued for meaningful contributions to shared resources (Alpha Mesh signals, marketplace listings, relay routing, governance).

All VCs are:
- Cryptographically signed by the issuer's Provenance Soul
- Self-contained (verifiable without network access)
- Tamper-evident (any field modification invalidates the Ed25519 signature)
- Replay-protected (unique `id` + per-claim `nonce`)

### 2.4 Reputation Algorithm

Reputation is a weighted composite of four dimensions:

```
R = 0.40 × Accuracy
  + 0.30 × Reliability      (time-decayed, 30-day half-life)
  + 0.20 × Contribution     (log10-scaled)
  + 0.10 × Tenure           (ln-scaled, caps at 1 year)
```

Time decay ensures that old successes don't permanently insulate an agent from current failures. The logarithmic contribution scaling prevents whale behavior (one large contribution counts less than many consistent small ones).

Reputation tiers drive provider behavior:

| Tier | Score | Provider Response |
|------|-------|-----------------------|
| Elite | ≥ 0.90 | Unlocks highest-latency endpoints, bulk access |
| Premium | ≥ 0.70 | Standard premium access |
| Standard | ≥ 0.40 | Rate-limited premium access |
| Basic | < 0.40 | Free tier only |

---

## 3. Integration Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     AGENT (any runtime)                      │
│  ┌──────────────┐   issues VC   ┌──────────────────────────┐│
│  │ Provenance   │─────────────►│  VC Wallet (local store) ││
│  │ Soul         │              └──────────────────────────┘│
│  │ (Ed25519)    │◄─ verifies ──  Provider Response Headers  │
│  └──────────────┘                                           │
└───────────────────┬─────────────────────────────────────────┘
                    │  x402 payment + X-VAPL-VC header
                    ▼
┌─────────────────────────────────────────────────────────────┐
│              SQUEEZEOS / 402PROOF / CRAWLTOLL                │
│  ┌──────────────────┐    ┌────────────────────────────────┐ │
│  │ 402Proof Payment │    │ VAPL Middleware                │ │
│  │ Firewall         │───►│ (verify incoming VC,           │ │
│  │                  │    │  issue outgoing VC,            │ │
│  └──────────────────┘    │  attach to response headers)   │ │
│                           └────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│                    VAPL REGISTRY (optional)                  │
│  POST /aggregate  →  store verified VCs                      │
│  GET  /reputation/<did>  →  reputation score                 │
│  GET  /.well-known/vapl.json  →  discovery manifest          │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 No Custody, No New Tokens

VAPL credentials are signed data structures. They carry no monetary value, no transferable balance, and no on-chain state. The only financial primitive they reference is the 402Proof payment system (existing SML infrastructure). VAPL itself is off-chain, off-ledger, and off-regulatory-radar.

### 3.2 Privacy by Design

- Provenance Souls are pseudonymous by default. An agent's DID reveals nothing except its public key.
- Agents selectively disclose VCs. They may present an AccuracyCredential without revealing which endpoints they queried.
- The VC `credentialSubject.id` field can hold a pseudonymous DID rather than a wallet address.
- Future: ZK-proof wrappers can prove "reputation ≥ 0.70" without revealing the underlying VC details.

---

## 4. Security Properties

| Property | Mechanism |
|----------|-----------|
| Unforgeability | Ed25519 signature over canonical JSON; requires private key |
| Tamper evidence | Any field change invalidates signature |
| Replay protection | Unique VC `id` (URN) + per-claim `nonce` |
| Expiry | `validUntil` field enforced by verifier (±5 min clock skew) |
| Issuer binding | Verification method ID must be `{issuer}#key-1` |
| Offline verification | `did:key` resolves locally; no network required |
| Trust filtering | Verifier accepts `trustedIssuers` allowlist |

See `spec/threat-model.md` for the full 15-threat matrix and attack scenario analysis.

---

## 5. Ecosystem Impact

### 5.1 For ScriptMasterLabs Products

- **SqueezeOS** — every council verdict, scan, and options flow call becomes auditable. Elite-tier agents get sub-second priority routing.
- **402Proof** — payment receipts can carry VAPL VCs, turning payment history into reputation history.
- **Crawltoll** — every crawl result carries a content-hash VC. Downstream agents verify data integrity without re-fetching.
- **Ghost Layer** — toll routes earn RelayRoute VCs; high-reliability relayers surface in the discovery manifest.
- **Signal Marketplace** — buyers verify seller accuracy before purchasing a thesis. Fraud-listed sellers cannot issue valid VCs from revoked DIDs.
- **Leviathan / Alpha Mesh** — contributor provenance for every signal, enabling weighted averaging by verified accuracy.

### 5.2 For the Agentic Ecosystem

VAPL is designed to be adopted beyond SML. The `eddsa-vapl-2024` cryptosuite is simple enough to implement in any language in hours (see the reference implementations). The `did:key` method requires no infrastructure. Any agent framework — Claude Code, OpenAI Assistants, LangChain, CrewAI — can integrate with a single library import.

---

## 6. Roadmap

| Phase | Milestone | Target |
|-------|-----------|--------|
| v1.0 | TypeScript + Python SDKs, spec, schemas | ✅ June 2026 |
| v1.1 | ZK reputation proofs (range proofs over composite score) | Q3 2026 |
| v1.2 | Cross-agent delegation VCs (Agent A authorizes Agent B) | Q3 2026 |
| v1.3 | Revocation registry (CRL-style, append-only log) | Q4 2026 |
| v2.0 | VAPL Registry as a federated P2P DHT | Q1 2027 |

---

## 7. Open Source Commitment

All VAPL components are MIT licensed. The specification, both SDKs, schemas, and deployment configs are published in the `sml_portfolio` monorepo under `vapl/`. Contributions welcome via pull request.

---

*ScriptMasterLabs — Building the trust layer for the agentic economy.*
