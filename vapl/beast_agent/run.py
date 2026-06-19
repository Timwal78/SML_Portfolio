"""Beast VAPL Agent — self-sustaining provenance and reputation loop.

Runs on GitHub Actions cron (5× weekday). Each execution:
  1. Restores the agent's ProvenanceSoul from VAPL_SOUL_B64 env (or generates on first run)
  2. Fetches a free signal preview from SqueezeOS
  3. Pays RLUSD via XRPL if a premium council verdict is warranted
  4. Issues InteractionVC + AccuracyVC per interaction
  5. Submits VCs to the VAPL registry
  6. Reputation score updates automatically — tier improves over time

Env vars required:
  AGENT_XRPL_SEED        — XRPL wallet seed for RLUSD payments
  AGENT_XRPL_ADDRESS     — XRPL wallet address
  VAPL_SOUL_B64          — base64url(json) of the agent's persistent ProvenanceSoul
                           (generate once: python -c "from vapl.py_sdk import generate_soul; ...")
  ANTHROPIC_API_KEY      — for Claude-powered signal reasoning (optional)
  PROOF402_SERVER_URL    — payment firewall (default: https://four02proof.onrender.com)
  SQUEEZEOS_BASE_URL     — signal source (default: https://squeezeos-api.onrender.com)
  VAPL_REGISTRY_URL      — registry (default: https://vapl-registry.onrender.com)
  SYMBOL                 — override target symbol (default: IWM)
  DRY_RUN                — if "true", skip registry submission
"""
from __future__ import annotations

import base64
import json
import logging
import os
import sys
import time
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

import requests

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("beast_vapl")

SQUEEZEOS_BASE = os.environ.get("SQUEEZEOS_BASE_URL", "https://squeezeos-api.onrender.com")
PROOF402_BASE = os.environ.get("PROOF402_SERVER_URL", "https://four02proof.onrender.com")
REGISTRY_URL = os.environ.get("VAPL_REGISTRY_URL", "https://vapl-registry.onrender.com")
SYMBOL = os.environ.get("SYMBOL", "IWM").upper()
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"

# ── Soul management ───────────────────────────────────────────────────────────

def _load_soul_from_env() -> Optional[dict]:
    b64 = os.environ.get("VAPL_SOUL_B64", "")
    if not b64:
        return None
    try:
        pad = 4 - len(b64) % 4
        raw = base64.urlsafe_b64decode(b64 + ("=" * pad if pad != 4 else ""))
        return json.loads(raw)
    except Exception as exc:
        log.warning("Could not decode VAPL_SOUL_B64: %s", exc)
        return None


def _generate_soul() -> dict:
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives.serialization import (
            Encoding, PublicFormat, PrivateFormat, NoEncryption,
        )
    except ImportError:
        log.error("cryptography package not installed — pip install cryptography")
        sys.exit(1)

    B58 = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

    def b58(data: bytes) -> str:
        leading = sum(1 for b in data if b == 0)
        n = int.from_bytes(data, "big")
        res: list[str] = []
        while n > 0:
            n, r = divmod(n, 58)
            res.append(B58[r:r + 1].decode())
        return "1" * leading + "".join(reversed(res))

    priv = Ed25519PrivateKey.generate()
    pub = priv.public_key()
    pub_raw = pub.public_bytes(Encoding.Raw, PublicFormat.Raw)
    priv_raw = priv.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
    multicodec = bytes([0xed, 0x01]) + pub_raw
    did = f"did:key:z{b58(multicodec)}"
    key_id = did[len("did:key:"):]
    return {
        "did": did,
        "verificationMethodId": f"{did}#{key_id}",
        "publicKeyMultibase": f"z{b58(multicodec)}",
        "publicKeyBase64url": base64.urlsafe_b64encode(pub_raw).rstrip(b"=").decode(),
        "privateKeyBase64url": base64.urlsafe_b64encode(priv_raw).rstrip(b"=").decode(),
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


# ── VC issuance (stdlib-only fallback path) ───────────────────────────────────

def _sign(priv_b64: str, message: bytes) -> bytes:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    pad = 4 - len(priv_b64) % 4
    raw = base64.urlsafe_b64decode(priv_b64 + ("=" * pad if pad != 4 else ""))
    key = Ed25519PrivateKey.from_private_bytes(raw)
    return key.sign(message)


def _canonical_json(obj: object) -> str:
    import json as _json
    if isinstance(obj, list):
        return "[" + ",".join(_canonical_json(i) for i in obj) + "]"
    if isinstance(obj, dict):
        return "{" + ",".join(
            f"{_json.dumps(k)}:{_canonical_json(obj[k])}"
            for k in sorted(obj.keys())
        ) + "}"
    return _json.dumps(obj)


def _nonce(n: int = 16) -> str:
    import secrets
    return base64.urlsafe_b64encode(secrets.token_bytes(n)).rstrip(b"=").decode()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def issue_vc(soul: dict, subject_did: str, vc_type: str, claim: dict) -> dict:
    import hashlib
    uid = f"urn:vapl:vc:{soul['did'][-8:]}:{int(time.time())}:{_nonce(6)}"
    valid_until = (datetime.now(timezone.utc) + timedelta(days=365)).isoformat().replace("+00:00", "Z")
    body = {
        "@context": [
            "https://www.w3.org/ns/credentials/v2",
            "https://vapl.scriptmasterlabs.com/v1/context.jsonld",
        ],
        "id": uid,
        "type": ["VerifiableCredential", vc_type],
        "issuer": soul["did"],
        "validFrom": _now_iso(),
        "validUntil": valid_until,
        "credentialSubject": {"id": subject_did, **claim},
    }
    digest = hashlib.sha256(_canonical_json(body).encode()).digest()
    sig = _sign(soul["privateKeyBase64url"], digest)
    body["proof"] = {
        "type": "DataIntegrityProof",
        "cryptosuite": "eddsa-vapl-2024",
        "created": _now_iso(),
        "verificationMethod": soul["verificationMethodId"],
        "proofPurpose": "assertionMethod",
        "nonce": _nonce(),
        "proofValue": base64.urlsafe_b64encode(sig).rstrip(b"=").decode(),
    }
    return body


def issue_interaction_vc(soul: dict, subject_did: str, itype: str, resource: str, outcome: str) -> dict:
    return issue_vc(soul, subject_did, "InteractionCredential", {
        "interaction": {
            "type": itype,
            "resource": resource,
            "timestamp": _now_iso(),
            "outcome": outcome,
            "nonce": _nonce(8),
        }
    })


def issue_accuracy_vc(soul: dict, subject_did: str, signal_id: str, prediction: str,
                      actual: str, score: float) -> dict:
    return issue_vc(soul, subject_did, "AccuracyCredential", {
        "accuracy": {
            "signalId": signal_id,
            "prediction": prediction,
            "actual": actual,
            "score": round(score, 4),
            "evaluatedAt": _now_iso(),
        }
    })


# ── XRPL payment helpers ──────────────────────────────────────────────────────

def _pay_rlusd(amount_drops: str, destination: str) -> Optional[str]:
    try:
        import xrpl.clients
        import xrpl.models.transactions
        import xrpl.wallet
        import xrpl.transaction

        seed = os.environ.get("AGENT_XRPL_SEED", "")
        if not seed:
            log.warning("AGENT_XRPL_SEED not set — skipping payment")
            return None

        wallet = xrpl.wallet.Wallet.from_seed(seed)
        client = xrpl.clients.JsonRpcClient("https://s1.ripple.com:51234/")
        tx = xrpl.models.transactions.Payment(
            account=wallet.classic_address,
            amount=xrpl.models.amounts.IssuedCurrencyAmount(
                currency="524C555344000000000000000000000000000000",
                issuer="rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De",
                value=str(float(amount_drops) / 1_000_000),
            ),
            destination=destination,
        )
        response = xrpl.transaction.submit_and_wait(tx, client, wallet)
        return response.result.get("hash")
    except Exception as exc:
        log.warning("XRPL payment failed: %s", exc)
        return None


# ── Registry submission ───────────────────────────────────────────────────────

def _submit_vc(vc: dict) -> bool:
    if DRY_RUN:
        log.info("[DRY RUN] Would submit VC id=%s", vc.get("id", "?"))
        return True
    try:
        resp = requests.post(
            f"{REGISTRY_URL}/register",
            json={"vc": vc},
            timeout=15,
            headers={"Content-Type": "application/json"},
        )
        if resp.status_code in (200, 201):
            log.info("VC registered: id=%s", vc.get("id", "?"))
            return True
        log.warning("Registry returned %d: %s", resp.status_code, resp.text[:200])
        return False
    except Exception as exc:
        log.warning("Registry submission failed: %s", exc)
        return False


# ── Main loop ─────────────────────────────────────────────────────────────────

def main() -> None:
    log.info("Beast VAPL Agent — symbol=%s dry_run=%s", SYMBOL, DRY_RUN)

    soul_dict = _load_soul_from_env()
    if soul_dict is None:
        log.info("No VAPL_SOUL_B64 found — generating ephemeral soul for this run")
        soul_dict = _generate_soul()
    agent_did = soul_dict["did"]
    log.info("Agent DID: %s", agent_did)

    # service soul for VC issuance (the agent is both issuer and subject here)
    service_soul = soul_dict

    vcs_issued: list[dict] = []

    # ── Step 1: free signal preview ──────────────────────────────────────────
    log.info("Fetching signal preview for %s ...", SYMBOL)
    try:
        resp = requests.get(f"{SQUEEZEOS_BASE}/api/preview/{SYMBOL}", timeout=30)
        preview = resp.json() if resp.ok else {}
        preview_status = "success" if resp.ok else "error"
        log.info("Preview: %s", json.dumps(preview, default=str)[:200])
    except Exception as exc:
        log.warning("Preview fetch failed: %s", exc)
        preview = {}
        preview_status = "error"

    vc = issue_interaction_vc(
        service_soul, agent_did, "SignalPreviewFetch",
        f"{SQUEEZEOS_BASE}/api/preview/{SYMBOL}", preview_status,
    )
    vcs_issued.append(vc)

    # Read vapl VC from response header if present
    inbound_vapl = resp.headers.get("X-VAPL-VC", "") if "resp" in dir() and resp.ok else ""
    if inbound_vapl:
        log.info("Received X-VAPL-VC from SqueezeOS (len=%d)", len(inbound_vapl))

    # ── Step 2: council verdict (premium, paid) ──────────────────────────────
    bias = preview.get("bias", "NEUTRAL") if isinstance(preview, dict) else "NEUTRAL"
    confidence = preview.get("confidence", 0) if isinstance(preview, dict) else 0

    if str(confidence) and float(str(confidence or 0)) < 60:
        log.info("Confidence %s < 60 — requesting paid council verdict", confidence)

        # Get invoice
        council_did = None
        try:
            inv_resp = requests.post(
                f"{PROOF402_BASE}/v1/invoice",
                json={
                    "endpoint": "/api/council",
                    "wallet": os.environ.get("AGENT_XRPL_ADDRESS", ""),
                },
                timeout=15,
            )
            if inv_resp.ok:
                inv = inv_resp.json()
                destination = inv.get("payment_destination", "")
                amount = inv.get("amount_drops", "100000")
                invoice_id = inv.get("invoice_id", "")
                log.info("Invoice id=%s amount=%s destination=%s", invoice_id, amount, destination)

                # Pay RLUSD
                tx_hash = _pay_rlusd(amount, destination)
                if tx_hash:
                    log.info("Payment tx: %s", tx_hash)
                    # Verify
                    vfy = requests.post(
                        f"{PROOF402_BASE}/v1/verify",
                        json={"invoice_id": invoice_id, "tx_hash": tx_hash},
                        timeout=15,
                    )
                    if vfy.ok:
                        token = vfy.json().get("token", "")
                        # Call council
                        council_resp = requests.post(
                            f"{SQUEEZEOS_BASE}/api/council",
                            json={"symbol": SYMBOL},
                            headers={"X-Payment-Token": token,
                                     "X-Agent-Wallet": os.environ.get("AGENT_XRPL_ADDRESS", "")},
                            timeout=30,
                        )
                        if council_resp.ok:
                            council = council_resp.json()
                            log.info("Council: %s", json.dumps(council, default=str)[:200])
                            bias = council.get("directive", bias)
                            confidence = council.get("confidence", confidence)

                            vc_council = issue_interaction_vc(
                                service_soul, agent_did, "CouncilVerdict",
                                f"{SQUEEZEOS_BASE}/api/council", "success",
                            )
                            vcs_issued.append(vc_council)

                            # Issue accuracy VC linking this prediction
                            signal_id = f"vapl:signal:{SYMBOL}:{int(time.time())}"
                            acc_vc = issue_accuracy_vc(
                                service_soul, agent_did,
                                signal_id, bias, "pending",
                                float(str(confidence or 0)) / 100.0,
                            )
                            vcs_issued.append(acc_vc)
        except Exception as exc:
            log.warning("Council flow failed: %s", exc)

    # ── Step 3: issue ContributionVC for this run ────────────────────────────
    contrib_vc = issue_vc(service_soul, agent_did, "ContributionCredential", {
        "contribution": {
            "type": "BeastAgentRun",
            "symbol": SYMBOL,
            "vcCount": len(vcs_issued),
            "timestamp": _now_iso(),
            "nonce": _nonce(8),
        }
    })
    vcs_issued.append(contrib_vc)

    # ── Step 4: submit all VCs to registry ──────────────────────────────────
    log.info("Submitting %d VCs to registry ...", len(vcs_issued))
    submitted = sum(1 for vc in vcs_issued if _submit_vc(vc))
    log.info("Submitted %d/%d VCs — Beast loop complete", submitted, len(vcs_issued))

    if submitted < len(vcs_issued):
        log.warning("Some VCs failed to submit — check registry logs")


if __name__ == "__main__":
    main()
