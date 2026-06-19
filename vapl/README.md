# VAPL — Verifiable Agent Provenance Layer

The self-sovereign trust and discovery backbone for the agentic web.

VAPL is an open-source, MIT-licensed protocol and SDK suite that gives AI agents **persistent cryptographic identities** and **verifiable interaction histories** — without custody, tokens, or regulatory surface.

Built on W3C Verifiable Credentials 2.0, DID:key (Ed25519), and the ScriptMasterLabs x402/AgentCard primitives.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      VAPL Stack                          │
├──────────────────────────────────────────────────────────┤
│  Agent                                                   │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Provenance Soul  (DID:key + Ed25519 keypair)      │  │
│  │  ┌──────────────┐  ┌─────────────────────────────┐ │  │
│  │  │  VC Wallet   │  │  Reputation Manifest (pub)  │ │  │
│  │  │  (signed VCs)│  │  agents.json extension      │ │  │
│  │  └──────────────┘  └─────────────────────────────┘ │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  Provider  (402Proof / Crawltoll / SqueezeOS / BEAST)    │
│  ┌────────────────────────────────────────────────────┐  │
│  │  VC Issuer Middleware                              │  │
│  │  Issues signed VC on every successful call        │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  Verifier  (any party, fully offline)                    │
│  ┌────────────────────────────────────────────────────┐  │
│  │  verifyVC() · computeReputationScore()             │  │
│  │  matchProviders() · verifyProvenance()             │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

## Packages

| Package | Language | Install |
|---------|----------|---------|
| `@scriptmasterlabs/vapl` | TypeScript | `npm install @scriptmasterlabs/vapl` |
| `vapl-py` | Python | `pip install vapl-py` |

## Quick Start — TypeScript

```typescript
import { generateSoul, issueInteractionVC, verifyVC, computeReputationScore } from '@scriptmasterlabs/vapl';

// 1. Generate a persistent identity
const soul = await generateSoul();
console.log(soul.did); // did:key:z6Mk...

// 2. Issue an interaction VC (called by providers)
const vc = await issueInteractionVC(soul, agentDid, {
  type: 'CouncilVerdict',
  resource: '/api/council',
  timestamp: new Date().toISOString(),
  outcome: 'success',
});

// 3. Verify a VC (fully offline, no network call)
const result = await verifyVC(vc, { trustedIssuers: [soul.did] });
console.log(result.valid); // true

// 4. Compute reputation score from a wallet of VCs
const score = await computeReputationScore(vcWallet, agentDid);
console.log(score.overall); // 0.0 – 1.0
```

## Quick Start — Python

```python
from vapl import generate_soul, issue_interaction_vc, verify_vc, compute_reputation_score

# 1. Generate identity
soul = generate_soul()
print(soul.did)  # did:key:z6Mk...

# 2. Issue VC
vc = issue_interaction_vc(
    soul, agent_did, 'CouncilVerdict', '/api/council', 'success',
    payment_tx_hash='ABC123', payment_amount='0.10', payment_currency='RLUSD'
)

# 3. Verify (offline)
result = verify_vc(vc, trusted_issuers=[soul.did])
print(result['valid'])  # True

# 4. Reputation score
score = compute_reputation_score(vc_wallet, agent_did)
print(score['overall'])  # 0.0 – 1.0
```

## Design Principles

1. **Zero custody** — private keys never leave the agent
2. **Zero new tokens** — RLUSD x402 is the economic layer; VAPL is pure cryptographic data
3. **Client-side verification** — all checks are Ed25519 signature verifications, no oracle
4. **Selective disclosure** — agents present only the VCs they choose
5. **Tamper-evident** — Ed25519 signatures over canonical JSON are unforgeable
6. **Replay-protected** — every VC carries a nonce; every credential has a unique ID

## Directory Layout

```
vapl/
├── spec/                    # Formal specification + JSON-LD schemas
├── ts-sdk/                  # TypeScript SDK (@scriptmasterlabs/vapl)
│   ├── src/
│   │   ├── identity/        # DID:key, keypair, soul
│   │   ├── credentials/     # VC schema, issuer, verifier
│   │   ├── reputation/      # Scoring algorithm
│   │   ├── discovery/       # Manifest generation, provider matching
│   │   └── integration/     # x402 / 402Proof helpers
│   └── tests/
├── py-sdk/                  # Python SDK (vapl-py)
│   ├── vapl/
│   │   ├── identity.py
│   │   ├── credentials.py
│   │   ├── reputation.py
│   │   ├── discovery.py
│   │   └── integration/
│   └── tests/
├── examples/
│   ├── beast-agent/         # Self-optimizing BEAST agent using VAPL
│   ├── 402proof-extension/  # Drop-in VC issuer for 402Proof
│   └── crawltoll-integration/
├── deployment/              # Docker, Kubernetes, Render configs
└── docs/                    # Whitepaper, integration guide, API reference
```

## License

MIT — see [LICENSE](LICENSE)
