#!/usr/bin/env python3
"""
VAPL Registry Service
======================
Minimal HTTP server that:
  GET /health          — liveness probe
  GET /manifest        — returns this node's ProvenanceSoulManifest
  GET /.well-known/vapl.json — same as /manifest (discovery convention)
  POST /verify         — verify a submitted VC (JSON body)
  POST /aggregate      — accept a VC into the local wallet and recompute scores
  GET /reputation/<did> — return reputation score for a known DID

Production hardening note: add authentication to /aggregate before
exposing to the internet. The demo accepts any valid VC.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [vapl-registry] %(levelname)s %(message)s",
)
log = logging.getLogger("vapl_registry")

try:
    from vapl import (
        generate_soul, ProvenanceSoul,
        verify_vc, compute_reputation_score,
        generate_provenance_soul_manifest,
    )
except ImportError:
    log.error("vapl-py not installed. Run: pip install vapl-py")
    sys.exit(1)

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------
SOUL_FILE = os.environ.get("VAPL_SOUL_FILE", "vapl_soul.json")
PORT      = int(os.environ.get("PORT", 8400))


def _load_soul() -> ProvenanceSoul:
    if os.path.exists(SOUL_FILE):
        with open(SOUL_FILE) as f:
            return ProvenanceSoul.from_dict(json.load(f))
    soul = generate_soul()
    os.makedirs(os.path.dirname(SOUL_FILE) or ".", exist_ok=True)
    with open(SOUL_FILE, "w") as f:
        json.dump(soul.to_dict(), f)
    return soul


SOUL: ProvenanceSoul = _load_soul()
VC_WALLET: list[dict[str, Any]] = []       # in-memory; swap to Redis in prod
DID_INDEX: dict[str, list[dict]] = {}      # did → [vc, ...]


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class VAPLHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:  # type: ignore[override]
        log.info(fmt, *args)

    def _send_json(self, status: int, body: Any) -> None:
        payload = json.dumps(body, indent=2).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("X-VAPL-Issuer", SOUL.did)
        self.end_headers()
        self.wfile.write(payload)

    def _read_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw)

    def do_GET(self) -> None:
        path = self.path.split("?")[0]

        if path == "/health":
            self._send_json(200, {"status": "ok", "did": SOUL.did})

        elif path in ("/manifest", "/.well-known/vapl.json"):
            manifest = generate_provenance_soul_manifest(
                soul=SOUL,
                service_name="VAPL Registry",
                description="ScriptMasterLabs VAPL provenance registry node",
                capabilities=[
                    "verify", "aggregate", "reputation",
                    "CouncilVerdict", "SqueezeOSScan",
                ],
                reputation_score=None,
            )
            self._send_json(200, manifest)

        elif path.startswith("/reputation/"):
            target_did = path.removeprefix("/reputation/")
            wallet = DID_INDEX.get(target_did, [])
            score = compute_reputation_score(target_did, wallet)
            self._send_json(200, score)

        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self) -> None:
        path = self.path.split("?")[0]

        if path == "/verify":
            try:
                body = self._read_body()
                vc = body.get("vc")
                if not vc:
                    self._send_json(400, {"error": "missing 'vc' field"})
                    return
                trusted = body.get("trusted_issuers")  # optional list
                valid, verified_vc, reason = verify_vc(vc, trusted_issuers=trusted)
                self._send_json(
                    200 if valid else 400,
                    {"valid": valid, "reason": reason, "vc": verified_vc if valid else None},
                )
            except Exception as exc:
                self._send_json(500, {"error": str(exc)})

        elif path == "/aggregate":
            try:
                body = self._read_body()
                vc = body.get("vc")
                if not vc:
                    self._send_json(400, {"error": "missing 'vc' field"})
                    return
                valid, verified_vc, reason = verify_vc(vc)
                if not valid:
                    self._send_json(400, {"error": f"invalid VC: {reason}"})
                    return
                VC_WALLET.append(verified_vc)
                # Index by subject DID
                subject = verified_vc.get("credentialSubject", {}).get("id", "")
                DID_INDEX.setdefault(subject, []).append(verified_vc)
                self._send_json(201, {"accepted": True, "id": verified_vc.get("id")})
            except Exception as exc:
                self._send_json(500, {"error": str(exc)})

        else:
            self._send_json(404, {"error": "not found"})


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    log.info("VAPL Registry starting on port %d | DID: %s", PORT, SOUL.did)
    server = HTTPServer(("", PORT), VAPLHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Shutting down")
