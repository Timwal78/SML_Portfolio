# VAPL API Reference

Complete reference for the Python (`vapl-py`) and TypeScript (`@scriptmasterlabs/vapl`) SDKs.

---

## Python SDK (`vapl-py`)

### Identity

#### `generate_soul() -> ProvenanceSoul`

Generates a fresh Ed25519 keypair and returns a `ProvenanceSoul`.
The private key is held in-memory only; persist with `soul.to_dict()`.

```python
from vapl import generate_soul
soul = generate_soul()
print(soul.did)  # did:key:z6Mk...
```

#### `ProvenanceSoul`

| Attribute | Type | Description |
|-----------|------|-------------|
| `did` | `str` | Full `did:key:z6Mk...` DID |
| `verification_method_id` | `str` | `{did}#key-1` |
| `public_key_bytes` | `bytes` | 32-byte Ed25519 public key |
| `private_key_bytes` | `bytes` | 32-byte Ed25519 private key |
| `public_key_multibase` | `str` | `z` + base58btc(multicodec + pubkey) |
| `created_at` | `str` | ISO-8601 UTC timestamp |

**Methods:**
- `soul.sign(message: bytes) -> bytes` — Ed25519 signature
- `soul.to_dict() -> dict` — serializable (private key base64url-encoded)
- `ProvenanceSoul.from_dict(d: dict) -> ProvenanceSoul` — restore from dict

#### `verify_signature(public_key_bytes: bytes, message: bytes, signature: bytes) -> bool`

Stateless Ed25519 signature verification. Returns `True` on valid signature.

---

### Credentials

#### `issue_interaction_vc(soul, subject_did, interaction_type, endpoint_id, provider_did, outcome, metadata) -> dict`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `soul` | `ProvenanceSoul` | Yes | Issuer soul |
| `subject_did` | `str` | Yes | Subject agent DID |
| `interaction_type` | `str` | Yes | One of 19 interaction types (see spec) |
| `endpoint_id` | `str` | Yes | Endpoint URL or identifier |
| `provider_did` | `str` | Yes | Provider DID |
| `outcome` | `str` | Yes | `success` \| `partial` \| `failed` |
| `metadata` | `dict` | No | Arbitrary JSON-serialisable metadata |

Returns a fully signed VC dict.

#### `issue_accuracy_vc(soul, subject_did, issuer_soul, measurement_window_start, measurement_window_end, total_predictions, correct_predictions, accuracy_rate, methodology) -> dict`

| Parameter | Type | Required |
|-----------|------|----------|
| `soul` | `ProvenanceSoul` | Yes |
| `subject_did` | `str` | Yes |
| `issuer_soul` | `ProvenanceSoul` | Yes |
| `measurement_window_start` | `str` | Yes | ISO-8601 |
| `measurement_window_end` | `str` | Yes | ISO-8601 |
| `total_predictions` | `int` | Yes | |
| `correct_predictions` | `int` | Yes | |
| `accuracy_rate` | `float` | Yes | `[0.0, 1.0]` |
| `methodology` | `str` | Yes | Description of measurement method |

#### `issue_contribution_vc(soul, subject_did, contribution_type, contribution_id, description, quality_score, metadata) -> dict`

| Parameter | Type | Required |
|-----------|------|----------|
| `soul` | `ProvenanceSoul` | Yes |
| `subject_did` | `str` | Yes |
| `contribution_type` | `str` | Yes | See ContributionCredential schema |
| `contribution_id` | `str` | Yes | Unique contribution identifier |
| `description` | `str` | Yes | Human-readable description |
| `quality_score` | `float` | Yes | `[0.0, 1.0]` |
| `metadata` | `dict` | No | |

#### `verify_vc(vc: dict, trusted_issuers: list[str] | None = None) -> tuple[bool, dict | None, str]`

Verifies a VC through 8 validation stages.

**Returns:** `(valid: bool, credential: dict | None, reason: str)`

- `valid` — `True` if all 8 stages pass
- `credential` — the original VC dict if valid, else `None`
- `reason` — human-readable validation result or failure reason

---

### Reputation

#### `compute_reputation_score(subject_did: str, vc_wallet: list[dict]) -> dict`

Computes the composite reputation score from a wallet of VCs.

**Returns:**
```python
{
    "did": "did:key:z6Mk...",
    "composite": 0.742,
    "components": {
        "accuracy": 0.88,
        "reliability": 0.71,
        "contribution": 0.52,
        "tenure": 0.38,
    },
    "vc_counts": {
        "interaction": 42,
        "accuracy": 3,
        "contribution": 7,
        "total": 52,
    },
    "computed_at": "2026-06-19T12:00:00Z",
}
```

#### `rank_agents(agents: list[str], vc_wallets: dict[str, list[dict]]) -> list[dict]`

Ranks a list of agent DIDs by reputation score (descending).

**Parameters:**
- `agents` — list of DID strings
- `vc_wallets` — mapping of DID → VC list

**Returns:** list of `{"did": ..., "score": {...}, "tier": "Elite"|"Premium"|"Standard"|"Basic"}` sorted by `composite` descending.

---

### Discovery

#### `generate_provenance_soul_manifest(soul, service_name, description, capabilities, reputation_score) -> dict`

Generates a `ProvenanceSoulManifest` suitable for serving at `/.well-known/vapl.json`.

#### `match_providers(manifest_list: list[dict], required_capability: str | None = None) -> list[dict]`

Filters and sorts a list of manifests by reputation score. Returns manifests sorted by score descending.

---

## TypeScript SDK (`@scriptmasterlabs/vapl`)

All async functions use `Promise`. Sync alternatives are noted.

### Identity

#### `generateSoul(): Promise<ProvenanceSoul>`

Generates a fresh Ed25519 soul.

#### `exportSoul(soul: ProvenanceSoul): StoredSoul`

Serializes soul to a JSON-safe object (private key as base64url).

#### `loadSoul(stored: StoredSoul): ProvenanceSoul`

Restores a soul from a serialized `StoredSoul`.

#### `resolveDid(did: string): DIDDocument`

Resolves a `did:key` to a DID Document. Throws on invalid DID format.

#### `sign(privateKey: Uint8Array, message: Uint8Array): Uint8Array`

Synchronous Ed25519 signature (via `@noble/curves`).

#### `verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean`

Synchronous Ed25519 verification.

---

### Credentials

#### `issueVC(soul: ProvenanceSoul, credentialData: CredentialData): SignedVC`

Low-level VC issuer. Prefer the typed helpers below.

#### `issueInteractionVC(soul, opts): SignedVC`

```typescript
interface InteractionVCOptions {
  subjectDid: string;
  interactionType: InteractionType;
  endpointId: string;
  providerDid: string;
  outcome: 'success' | 'partial' | 'failed';
  metadata?: Record<string, unknown>;
}
```

#### `issueAccuracyVC(soul, opts): SignedVC`

```typescript
interface AccuracyVCOptions {
  subjectDid: string;
  measurementWindowStart: string;
  measurementWindowEnd: string;
  totalPredictions: number;
  correctPredictions: number;
  accuracyRate: number;
  methodology: string;
}
```

#### `issueContributionVC(soul, opts): SignedVC`

```typescript
interface ContributionVCOptions {
  subjectDid: string;
  contributionType: ContributionType;
  contributionId: string;
  description: string;
  qualityScore: number;
  metadata?: Record<string, unknown>;
}
```

#### `verifyVC(vc: unknown, opts?: VerifyOptions): VerifyResult`

```typescript
interface VerifyOptions {
  trustedIssuers?: string[];
  clockSkewMinutes?: number;  // default: 5
}

interface VerifyResult {
  valid: boolean;
  credential: SignedVC | null;
  reason: string;
}
```

#### `verifyVCBatch(vcs: unknown[], opts?: VerifyOptions): VerifyResult[]`

Verifies an array of VCs. Returns one `VerifyResult` per input.

---

### Reputation

#### `computeReputationScore(subjectDid: string, vcWallet: SignedVC[]): ReputationScore`

```typescript
interface ReputationScore {
  did: string;
  composite: number;
  components: {
    accuracy: number;
    reliability: number;
    contribution: number;
    tenure: number;
  };
  vcCounts: {
    interaction: number;
    accuracy: number;
    contribution: number;
    total: number;
  };
  computedAt: string;
}
```

#### `rankAgents(agents: string[], vcWallets: Record<string, SignedVC[]>): RankedAgent[]`

```typescript
interface RankedAgent {
  did: string;
  score: ReputationScore;
  tier: 'Elite' | 'Premium' | 'Standard' | 'Basic';
}
```

---

### x402 / HTTP Integration

#### `vaplResponseHeaders(vc: SignedVC): Record<string, string>`

Returns `{ 'X-VAPL-VC': ..., 'X-VAPL-Issuer': ..., 'X-VAPL-VC-ID': ... }`.

#### `parseVaplHeaders(headers: Record<string, string>): { vc: SignedVC | null; issuerDid: string | null; vcId: string | null }`

Parses VAPL headers from an HTTP response object.

#### `createPresentation(soul: ProvenanceSoul, vcs: SignedVC[], challenge?: string): VCPresentation`

Wraps selected VCs in a Verifiable Presentation signed by the soul.

#### `issueX402InteractionVC(soul, payment, endpoint, outcome, metadata): SignedVC`

Specialized helper that combines x402 payment metadata with a VAPL InteractionCredential.

---

## VC Schema Reference

Full JSON Schema files are in `vapl/spec/schemas/`.

| File | VC Type | Key Constraints |
|------|---------|----------------|
| `interaction-vc.schema.json` | InteractionCredential | `interactionType` enum (19 values), `outcome` enum |
| `accuracy-vc.schema.json` | AccuracyCredential | `accuracyRate` [0,1], `totalPredictions` ≥ 1 |
| `contribution-vc.schema.json` | ContributionCredential | `qualityScore` [0,1], `contributionType` enum |

## Interaction Types

```
CouncilVerdict       SqueezeOSScan        OptionsFlowFetch
IWMScoreFetch        MarketplaceRead      MarketplaceListing
FuturesPrediction    SettlementResolution CrawltollFetch
AgentHire            RelayRoute           WebhookSubscription
GhostLayerRoute      XDEOEarningsEstimate AlphaMeshContribution
EchoPatternMatch     ShadowIngest         AgentCardVerify
LeviathanSignalFetch
```
