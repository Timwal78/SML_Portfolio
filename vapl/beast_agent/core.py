"""Shared utilities for all Beast VAPL swarm agents.

Soul management, VC issuance, XRPL payments, registry submission,
and marketplace operations — everything the strategies need.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import sys
import time
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

import requests

log = logging.getLogger("beast_vapl")

SQUEEZEOS_BASE = os.environ.get("SQUEEZEOS_BASE_URL", "https://squeezeos-api.onrender.com")
PROOF402_BASE  = os.environ.get("PROOF402_SERVER_URL", "https://four02proof.onrender.com")
REGISTRY_URL   = os.environ.get("VAPL_REGISTRY_URL",  "https://vapl-registry.onrender.com")
DRY_RUN        = os.environ.get("DRY_RUN", "false").lower() == "true"

MIN_WITHDRAW_RLUSD = 0.05
RLUSD_ISSUER       = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De"
RLUSD_CURRENCY     = "524C555344000000000000000000000000000000"


# ── Soul management ───────────────────────────────────────────────────────────

def load_soul() -> dict:
    """Load ProvenanceSoul from env or generate an ephemeral one."""
    b64 = os.environ.get("VAPL_SOUL_B64", "")
    if b64:
        try:
            pad = 4 - len(b64) % 4
            raw = base64.urlsafe_b64decode(b64 + ("=" * pad if pad != 4 else ""))
            soul = json.loads(raw)
            log.info("Loaded soul: %s", soul["did"])
            return soul
        except Exception as exc:
            log.warning("Could not decode VAPL_SOUL_B64: %s", exc)
    log.info("No VAPL_SOUL_B64 — generating ephemeral soul")
    return _generate_soul()


def _generate_soul() -> dict:
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives.serialization import (
            Encoding, PublicFormat, PrivateFormat, NoEncryption,
        )
    except ImportError:
        log.error("cryptography not installed — pip install cryptography")
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

    priv    = Ed25519PrivateKey.generate()
    pub     = priv.public_key()
    pub_raw = pub.public_bytes(Encoding.Raw, PublicFormat.Raw)
    priv_raw = priv.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
    multicodec = bytes([0xed, 0x01]) + pub_raw
    did     = f"did:key:z{b58(multicodec)}"
    key_id  = did[len("did:key:"):]
    return {
        "did":                  did,
        "verificationMethodId": f"{did}#{key_id}",
        "publicKeyMultibase":   f"z{b58(multicodec)}",
        "publicKeyBase64url":   base64.urlsafe_b64encode(pub_raw).rstrip(b"=").decode(),
        "privateKeyBase64url":  base64.urlsafe_b64encode(priv_raw).rstrip(b"=").decode(),
        "createdAt":            _now_iso(),
    }


# ── Crypto helpers ────────────────────────────────────────────────────────────

def sign(priv_b64: str, message: bytes) -> bytes:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    pad = 4 - len(priv_b64) % 4
    raw = base64.urlsafe_b64decode(priv_b64 + ("=" * pad if pad != 4 else ""))
    return Ed25519PrivateKey.from_private_bytes(raw).sign(message)


def canonical_json(obj: object) -> str:
    if isinstance(obj, list):
        return "[" + ",".join(canonical_json(i) for i in obj) + "]"
    if isinstance(obj, dict):
        return "{" + ",".join(
            f"{json.dumps(k)}:{canonical_json(obj[k])}"
            for k in sorted(obj.keys())
        ) + "}"
    return json.dumps(obj)


def nonce(n: int = 16) -> str:
    import secrets
    return base64.urlsafe_b64encode(secrets.token_bytes(n)).rstrip(b"=").decode()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# ── VC issuance ───────────────────────────────────────────────────────────────

def issue_vc(soul: dict, subject_did: str, vc_type: str, claim: dict) -> dict:
    uid        = f"urn:vapl:vc:{soul['did'][-8:]}:{int(time.time())}:{nonce(6)}"
    valid_until = (datetime.now(timezone.utc) + timedelta(days=365)).isoformat().replace("+00:00", "Z")
    body = {
        "@context": [
            "https://www.w3.org/ns/credentials/v2",
            "https://vapl.scriptmasterlabs.com/v1/context.jsonld",
        ],
        "id":               uid,
        "type":             ["VerifiableCredential", vc_type],
        "issuer":           soul["did"],
        "validFrom":        _now_iso(),
        "validUntil":       valid_until,
        "credentialSubject": {"id": subject_did, **claim},
    }
    digest = hashlib.sha256(canonical_json(body).encode()).digest()
    sig    = sign(soul["privateKeyBase64url"], digest)
    body["proof"] = {
        "type":               "DataIntegrityProof",
        "cryptosuite":        "eddsa-vapl-2024",
        "created":            _now_iso(),
        "verificationMethod": soul["verificationMethodId"],
        "proofPurpose":       "assertionMethod",
        "nonce":              nonce(),
        "proofValue":         base64.urlsafe_b64encode(sig).rstrip(b"=").decode(),
    }
    return body


def issue_interaction_vc(soul: dict, subject_did: str,
                         itype: str, resource: str, outcome: str) -> dict:
    return issue_vc(soul, subject_did, "InteractionCredential", {
        "interaction": {
            "type":      itype,
            "resource":  resource,
            "timestamp": _now_iso(),
            "outcome":   outcome,
            "nonce":     nonce(8),
        }
    })


def issue_accuracy_vc(soul: dict, subject_did: str, signal_id: str,
                      prediction: str, actual: str, score: float) -> dict:
    return issue_vc(soul, subject_did, "AccuracyCredential", {
        "accuracy": {
            "signalId":   signal_id,
            "prediction": prediction,
            "actual":     actual,
            "score":      round(score, 4),
            "evaluatedAt": _now_iso(),
        }
    })


def issue_contribution_vc(soul: dict, strategy_name: str, vc_count: int) -> dict:
    return issue_vc(soul, soul["did"], "ContributionCredential", {
        "contribution": {
            "type":      "BeastSwarmRun",
            "strategy":  strategy_name,
            "vcCount":   vc_count,
            "timestamp": _now_iso(),
            "nonce":     nonce(8),
        }
    })


# ── XRPL payment ─────────────────────────────────────────────────────────────

def pay_rlusd(amount_drops: str, destination: str) -> Optional[str]:
    """Send RLUSD from agent wallet. amount_drops is micro-RLUSD (÷1,000,000)."""
    try:
        import xrpl.clients, xrpl.models.transactions, xrpl.models.amounts
        import xrpl.wallet, xrpl.transaction

        seed = os.environ.get("AGENT_XRPL_SEED", "")
        if not seed:
            log.warning("AGENT_XRPL_SEED not set — skipping payment")
            return None

        wallet  = xrpl.wallet.Wallet.from_seed(seed)
        client  = xrpl.clients.JsonRpcClient("https://s1.ripple.com:51234/")
        tx      = xrpl.models.transactions.Payment(
            account=wallet.classic_address,
            amount=xrpl.models.amounts.IssuedCurrencyAmount(
                currency=RLUSD_CURRENCY,
                issuer=RLUSD_ISSUER,
                value=str(float(amount_drops) / 1_000_000),
            ),
            destination=destination,
        )
        response = xrpl.transaction.submit_and_wait(tx, client, wallet)
        return response.result.get("hash")
    except Exception as exc:
        log.warning("XRPL payment failed: %s", exc)
        return None


# ── Registry ──────────────────────────────────────────────────────────────────

def submit_vc(vc: dict) -> bool:
    if DRY_RUN:
        log.info("[DRY RUN] VC id=%s", vc.get("id", "?"))
        return True
    try:
        resp = requests.post(
            f"{REGISTRY_URL}/register",
            json={"vc": vc},
            timeout=15,
            headers={"Content-Type": "application/json"},
        )
        if resp.status_code in (200, 201):
            log.info("VC registered: %s", vc.get("id", "?"))
            return True
        log.warning("Registry %d: %s", resp.status_code, resp.text[:200])
        return False
    except Exception as exc:
        log.warning("Registry failed: %s", exc)
        return False


def submit_all(vcs: list) -> int:
    submitted = sum(1 for vc in vcs if submit_vc(vc))
    log.info("Submitted %d/%d VCs", submitted, len(vcs))
    return submitted


# ── Council verdict ───────────────────────────────────────────────────────────

def get_council_verdict(soul: dict, symbol: str, vcs: list) -> tuple[str, float]:
    """Get a paid 402Proof council verdict. Returns (bias, confidence)."""
    wallet = os.environ.get("AGENT_XRPL_ADDRESS", "")
    try:
        inv_resp = requests.post(
            f"{PROOF402_BASE}/v1/invoice",
            json={"endpoint": "/api/council", "wallet": wallet},
            timeout=15,
        )
        if not inv_resp.ok:
            return "NEUTRAL", 0.0

        inv         = inv_resp.json()
        destination = inv.get("payment_destination", "")
        amount      = inv.get("amount_drops", "100000")
        invoice_id  = inv.get("invoice_id", "")
        log.info("Invoice id=%s amount=%s", invoice_id, amount)

        tx_hash = pay_rlusd(amount, destination)
        if not tx_hash:
            return "NEUTRAL", 0.0
        log.info("Payment tx: %s", tx_hash)

        vfy = requests.post(
            f"{PROOF402_BASE}/v1/verify",
            json={"invoice_id": invoice_id, "tx_hash": tx_hash},
            timeout=15,
        )
        if not vfy.ok:
            return "NEUTRAL", 0.0

        token = vfy.json().get("token", "")
        council_resp = requests.post(
            f"{SQUEEZEOS_BASE}/api/council",
            json={"symbol": symbol},
            headers={"X-Payment-Token": token, "X-Agent-Wallet": wallet},
            timeout=30,
        )
        if council_resp.ok:
            council    = council_resp.json()
            bias       = council.get("directive", "NEUTRAL")
            confidence = float(str(council.get("confidence", 0) or 0))
            log.info("Council %s: %s conf=%.1f", symbol, bias, confidence)
            vcs.append(issue_interaction_vc(
                soul, soul["did"], "CouncilVerdict",
                f"{SQUEEZEOS_BASE}/api/council", "success",
            ))
            return bias, confidence

    except Exception as exc:
        log.warning("Council flow failed: %s", exc)

    return "NEUTRAL", 0.0


# ── Marketplace helpers ───────────────────────────────────────────────────────

def marketplace_list(wallet: str, symbol: str, bias: str, confidence: float,
                     thesis: str, signal_type: str = "SQUEEZE",
                     ttl_hours: int = 24) -> Optional[str]:
    """List a signal on Alpha Mesh. Returns listing_id or None."""
    if not wallet:
        log.warning("No AGENT_XRPL_ADDRESS — skipping listing")
        return None
    try:
        resp = requests.post(
            f"{SQUEEZEOS_BASE}/api/marketplace/list",
            json={
                "wallet":      wallet,
                "symbol":      symbol,
                "bias":        bias,
                "confidence":  confidence,
                "signal_type": signal_type,
                "thesis":      thesis,
                "timeframe":   "1D",
                "ttl_hours":   ttl_hours,
            },
            timeout=15,
        )
        if resp.ok:
            lid = resp.json().get("listing_id", "?")
            log.info("Listed %s %s conf=%.1f → %s", symbol, bias, confidence, lid[:8])
            return lid
        log.warning("Listing failed %d: %s", resp.status_code, resp.text[:120])
    except Exception as exc:
        log.warning("Marketplace list error: %s", exc)
    return None


def marketplace_browse(symbol_filter: str = "", limit: int = 20) -> list:
    """Browse marketplace listings."""
    try:
        params: dict = {"per_page": limit}
        if symbol_filter:
            params["symbol"] = symbol_filter
        resp = requests.get(f"{SQUEEZEOS_BASE}/api/marketplace", params=params, timeout=10)
        if resp.ok:
            return resp.json().get("listings", [])
    except Exception as exc:
        log.warning("Marketplace browse error: %s", exc)
    return []


def marketplace_buy(payment_token: str, agent_wallet: str,
                    listing_id: str) -> Optional[dict]:
    """Buy a marketplace signal using a 402Proof payment token."""
    try:
        resp = requests.post(
            f"{SQUEEZEOS_BASE}/api/marketplace/read",
            json={"listing_id": listing_id},
            headers={"X-Payment-Token": payment_token, "X-Agent-Wallet": agent_wallet},
            timeout=15,
        )
        if resp.ok:
            return resp.json()
        log.warning("Marketplace buy failed %d: %s", resp.status_code, resp.text[:120])
    except Exception as exc:
        log.warning("Marketplace buy error: %s", exc)
    return None


def get_marketplace_token(wallet: str, listing_id: str) -> Optional[str]:
    """Invoice + pay + verify → return payment token for marketplace buy."""
    try:
        inv_resp = requests.post(
            f"{PROOF402_BASE}/v1/invoice",
            json={"endpoint": "/api/marketplace/read", "wallet": wallet},
            timeout=15,
        )
        if not inv_resp.ok:
            return None

        inv         = inv_resp.json()
        destination = inv.get("payment_destination", "")
        amount      = inv.get("amount_drops", "20000")
        invoice_id  = inv.get("invoice_id", "")

        tx_hash = pay_rlusd(amount, destination)
        if not tx_hash:
            return None

        vfy = requests.post(
            f"{PROOF402_BASE}/v1/verify",
            json={"invoice_id": invoice_id, "tx_hash": tx_hash},
            timeout=15,
        )
        if vfy.ok:
            return vfy.json().get("token", "")
    except Exception as exc:
        log.warning("Marketplace payment failed: %s", exc)
    return None


def check_and_withdraw(soul: dict) -> Optional[dict]:
    """Check balance and withdraw earnings if above MIN_WITHDRAW_RLUSD."""
    wallet = os.environ.get("AGENT_XRPL_ADDRESS", "")
    if not wallet:
        return None

    try:
        bal = requests.get(
            f"{SQUEEZEOS_BASE}/api/marketplace/balance/{wallet}", timeout=10,
        )
        if not bal.ok:
            return None
        balance = float(bal.json().get("balance_rlusd", 0))
        if balance < MIN_WITHDRAW_RLUSD:
            log.info("Balance %.4f RLUSD < %.2f — skip withdraw", balance, MIN_WITHDRAW_RLUSD)
            return None
        log.info("Balance %.4f RLUSD — withdrawing", balance)
    except Exception as exc:
        log.warning("Balance check failed: %s", exc)
        return None

    # Build DID-signed withdraw request
    ts  = int(time.time())
    n   = nonce(12)
    msg = {"agent_did": soul["did"], "nonce": n, "timestamp": ts, "wallet": wallet}
    digest    = hashlib.sha256(canonical_json(msg).encode()).digest()
    sig_bytes = sign(soul["privateKeyBase64url"], digest)
    signature = base64.urlsafe_b64encode(sig_bytes).rstrip(b"=").decode()

    try:
        resp = requests.post(
            f"{SQUEEZEOS_BASE}/api/marketplace/withdraw",
            json={
                "wallet":    wallet,
                "agent_did": soul["did"],
                "timestamp": ts,
                "nonce":     n,
                "signature": signature,
            },
            timeout=30,
        )
        if resp.ok:
            result = resp.json()
            log.info(
                "Withdrew %.4f RLUSD → %s tx=%s",
                result.get("amount_rlusd"), wallet[:12],
                str(result.get("tx_hash", "?"))[:16],
            )
            return result
        log.warning("Withdraw failed %d: %s", resp.status_code, resp.text[:200])
    except Exception as exc:
        log.warning("Withdraw error: %s", exc)
    return None
