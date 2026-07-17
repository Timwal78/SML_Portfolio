# VAPL Integration Guide

How to add VAPL provenance to existing ScriptMasterLabs services.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [SqueezeOS (Python / Flask)](#squeezeos-python--flask)
3. [402Proof payment receipts](#402proof-payment-receipts)
4. [Crawltoll fetch provenance](#crawltoll-fetch-provenance)
5. [Ghost Layer routing VCs](#ghost-layer-routing-vcs)
6. [TypeScript agent (x402 client)](#typescript-agent-x402-client)
7. [Verifying VCs in any service](#verifying-vcs-in-any-service)
8. [Discovery manifest](#discovery-manifest)
9. [VAPL Registry (optional)](#vapl-registry-optional)
10. [Environment variables reference](#environment-variables-reference)

---

## Prerequisites

**Python services:**
```bash
pip install vapl-py       # or: pip install -e vapl/py-sdk
```

**TypeScript / Node services:**
```bash
npm install @scriptmasterlabs/vapl
```

**Minimum Python version:** 3.10  
**Minimum Node version:** 18 (for `crypto.subtle` or `@noble/curves`)

---

## SqueezeOS (Python / Flask)

### 1. Generate and persist the service soul

In `core/app.py`, inside `create_app()`:

```python
import json, os
from vapl import generate_soul, ProvenanceSoul

SOUL_FILE = os.environ.get("VAPL_SOUL_FILE", ".squeezeos_soul.json")

def _get_or_create_soul() -> ProvenanceSoul:
    if os.path.exists(SOUL_FILE):
        with open(SOUL_FILE) as f:
            return ProvenanceSoul.from_dict(json.load(f))
    soul = generate_soul()
    with open(SOUL_FILE, "w") as f:
        json.dump(soul.to_dict(), f)
    return soul

app_soul = _get_or_create_soul()
```

### 2. Install the VAPL middleware

```python
from vapl.examples.402proof_extension.vc_issuer_middleware import install_vapl_middleware
# or copy the middleware directly into your codebase

install_vapl_middleware(app, app_soul)
```

That's it. Every `2xx` response now carries:
```
X-VAPL-VC: <base64url-encoded JSON VC>
X-VAPL-Issuer: did:key:z6Mk...
X-VAPL-VC-ID: urn:vapl:vc:...
```

### 3. Expose the discovery manifest

```python
from flask import jsonify
from vapl import generate_provenance_soul_manifest

@app.route("/.well-known/vapl.json")
def vapl_manifest():
    manifest = generate_provenance_soul_manifest(
        soul=app_soul,
        service_name="SqueezeOS",
        description="Institutional-grade AI trading intelligence",
        capabilities=[
            "CouncilVerdict", "SqueezeOSScan", "OptionsFlowFetch",
            "IWMScoreFetch", "MarketplaceRead",
        ],
        reputation_score=None,
    )
    return jsonify(manifest)
```

### 4. Add VAPL_SOUL_FILE to render.yaml / .env

```yaml
# render.yaml
envVars:
  - key: VAPL_SOUL_FILE
    value: /var/data/squeezeos_soul.json
```

Use a Render Disk or persistent volume so the soul survives redeploys.

---

## 402Proof payment receipts

Extend the invoice response to include the payer's DID and a payment VC.

```python
from vapl import issue_interaction_vc

# Inside your /v1/invoice handler, after confirming XRPL payment:
agent_did = request.json.get("agent_did")  # passed by client

if agent_did and agent_did.startswith("did:key:"):
    payment_vc = issue_interaction_vc(
        soul=proof402_soul,          # 402Proof service soul
        subject_did=agent_did,
        interaction_type="CouncilVerdict",   # or whatever was purchased
        endpoint_id=f"/v1/invoice/{invoice_id}",
        provider_did=proof402_soul.did,
        outcome="success",
        metadata={
            "invoice_id": invoice_id,
            "amount_rlusd": amount_rlusd,
            "tx_hash": xrpl_tx_hash,
        },
    )
    response_body["vapl_vc"] = payment_vc
```

Clients save this VC to their wallet to build reliability history.

---

## Crawltoll fetch provenance

See the ready-made plugin at `vapl/examples/crawltoll-integration/crawltoll_plugin.py`.

Minimal integration:

```python
from crawltoll_plugin import CrawltollVAPLPlugin
from vapl import generate_soul

soul = load_or_create_soul()   # persistent across restarts
plugin = CrawltollVAPLPlugin(soul=soul)

# In your existing fetch handler:
raw = fetch_url(url)                              # your existing code
result = plugin.wrap(url=url, raw_result=raw, cost_rlusd=0.001)

# result.vapl_vc is a self-contained, verifiable credential
return result.to_dict()
```

Downstream consumers verify with:
```python
from vapl import verify_vc
valid, vc, reason = verify_vc(
    result["vapl_vc"],
    trusted_issuers=[KNOWN_CRAWLTOLL_DID],
)
```

---

## Ghost Layer routing VCs

In the Go Ghost Layer service, call the Python VAPL SDK via subprocess or
implement the `eddsa-vapl-2024` cryptosuite in Go (the algorithm is trivial:
`sha256(canonicalJson(vcWithoutProof))` → `ed25519.Sign`).

Alternatively, issue VCs from a sidecar Python process over a Unix socket:

```
Ghost Layer (Go) ──── IPC ────► VAPL Sidecar (Python)
                                 issues RelayRoute VC
                                 returns VC JSON
```

The sidecar runs `vapl/deployment/registry_service.py` on `localhost:8400`
and Ghost Layer calls `POST /aggregate` to record each route event.

---

## TypeScript agent (x402 client)

```typescript
import {
  generateSoul, issueInteractionVC,
  verifyVC, createPresentation, parseVaplHeaders,
} from '@scriptmasterlabs/vapl';

// 1. One-time setup
const soul = await generateSoul();
console.log('Agent DID:', soul.did);

// 2. Call a VAPL-enabled endpoint
const res = await fetch('https://squeezeos-api.onrender.com/api/preview/IWM', {
  headers: { 'X-Agent-Wallet': soul.did },
});

// 3. Parse the VC from the response
const incoming = parseVaplHeaders(Object.fromEntries(res.headers));
if (incoming.vc) {
  const { valid, reason } = await verifyVC(incoming.vc, {
    trustedIssuers: [KNOWN_SQUEEZEOS_DID],
  });
  console.log('Provider VC valid:', valid, reason);
}

// 4. Issue your own interaction VC for your records
const myVC = await issueInteractionVC(soul, {
  subjectDid: soul.did,
  interactionType: 'SqueezeOSScan',
  endpointId: 'https://squeezeos-api.onrender.com/api/preview/IWM',
  providerDid: soul.did,
  outcome: 'success',
  metadata: { symbol: 'IWM' },
});
```

---

## Verifying VCs in any service

### Python

```python
from vapl import verify_vc

valid, vc, reason = verify_vc(
    vc_dict,
    trusted_issuers=["did:key:z6Mk...squeezeos..."],
)
if not valid:
    raise ValueError(f"VC rejected: {reason}")
```

### TypeScript

```typescript
import { verifyVC } from '@scriptmasterlabs/vapl';

const { valid, credential, reason } = await verifyVC(vcObj, {
  trustedIssuers: ['did:key:z6Mk...squeezeos...'],
});
if (!valid) throw new Error(`VC rejected: ${reason}`);
```

### What the verifier checks (8 stages)

1. `@context` includes `https://www.w3.org/ns/credentials/v2`
2. `type` includes `VerifiableCredential`
3. `issuer` is present and non-empty
4. `proof` has all required fields (`type`, `created`, `verificationMethod`, `proofPurpose`, `proofValue`)
5. `issuer` is in `trustedIssuers` (if provided)
6. `issuer` is a `did:key:` DID
7. `validFrom`/`validUntil` are within ±5 minutes clock skew
8. Ed25519 signature over canonical JSON (without `proof`) is valid

---

## Discovery manifest

Serve `/.well-known/vapl.json` from every VAPL-enabled service.
Content is a `ProvenanceSoulManifest`:

```json
{
  "@context": "https://vapl.scriptmasterlabs.com/v1",
  "type": "ProvenanceSoulManifest",
  "did": "did:key:z6Mk...",
  "service": "SqueezeOS",
  "description": "...",
  "capabilities": ["CouncilVerdict", "SqueezeOSScan"],
  "reputationScore": null,
  "endpoints": {
    "verify": "https://squeezeos-api.onrender.com/vapl/verify",
    "aggregate": "https://squeezeos-api.onrender.com/vapl/aggregate"
  },
  "created": "2026-06-19T00:00:00Z"
}
```

Clients discover service DIDs by fetching this manifest and then restrict
`trustedIssuers` to the discovered DID.

---

## VAPL Registry (optional)

The registry service aggregates VCs from multiple agents and exposes reputation scores.
See `vapl/deployment/` for Docker, Render, and Kubernetes configs.

### Start locally

```bash
cd vapl
docker compose up
```

Endpoints:
- `GET  http://localhost:8400/health`
- `GET  http://localhost:8400/.well-known/vapl.json`
- `POST http://localhost:8400/aggregate`   — body: `{"vc": <vc_object>}`
- `GET  http://localhost:8400/reputation/<did>`
- `POST http://localhost:8400/verify`      — body: `{"vc": <vc_object>}`

---

## Environment variables reference

| Variable | Default | Description |
|----------|---------|-------------|
| `VAPL_SOUL_FILE` | `.vapl_soul.json` | Path to persistent soul JSON. Use a mounted disk in production. |
| `SQUEEZEOS_BASE` | `https://squeezeos-api.onrender.com` | SqueezeOS base URL for BEAST agent example. |
| `PROOF402_BASE` | `https://four02proof.onrender.com` | 402Proof base URL. |
| `PORT` | `8400` | VAPL registry HTTP port. |
| `REDIS_URL` | *(none)* | Optional Redis for VC wallet persistence in the registry service. |
