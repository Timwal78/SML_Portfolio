#!/usr/bin/env python3
"""
402Proof VAPL Extension Middleware
===================================
Drop-in Flask after_request middleware that auto-issues a VAPL
InteractionCredential for every successful 402Proof-gated response.

Deploy by importing and calling `install_vapl_middleware(app, soul)` in
your Flask application factory (e.g. core/app.py in SqueezeOS).

VC is returned in response headers:
  X-VAPL-VC       : base64url(json(vc))
  X-VAPL-Issuer   : did:key:z6Mk...
  X-VAPL-VC-ID    : urn:vapl:vc:...

Clients validate offline using the VAPL TypeScript or Python SDK.
"""

from __future__ import annotations

import base64
import json
import logging
import os
from typing import Any

log = logging.getLogger("vapl.402proof")

# ---------------------------------------------------------------------------
# Endpoint → interaction type mapping (mirrors proof402_integration.py)
# ---------------------------------------------------------------------------
ENDPOINT_TYPE_MAP: dict[str, str] = {
    "/api/council":          "CouncilVerdict",
    "/api/scan":             "SqueezeOSScan",
    "/api/options":          "OptionsFlowFetch",
    "/api/iwm":              "IWMScoreFetch",
    "/api/marketplace/read": "MarketplaceRead",
    "/api/marketplace":      "MarketplaceListing",
    "/api/futures":          "FuturesPrediction",
    "/api/settlement":       "SettlementResolution",
    "/api/hiring":           "AgentHire",
    "/api/relay":            "RelayRoute",
    "/api/webhooks":         "WebhookSubscription",
    "/api/graph":            "AlphaMeshContribution",
    "/api/preview":          "SqueezeOSScan",
    "/api/oracle":           "CouncilVerdict",
}


def _interaction_type_for_path(path: str) -> str:
    """Best-match endpoint → interaction type. Falls back to 'CouncilVerdict'."""
    for prefix, itype in ENDPOINT_TYPE_MAP.items():
        if path.startswith(prefix):
            return itype
    return "CouncilVerdict"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


# ---------------------------------------------------------------------------
# Middleware installer
# ---------------------------------------------------------------------------

def install_vapl_middleware(app: Any, soul: Any) -> None:
    """
    Install VAPL VC issuance as a Flask after_request hook.

    Args:
        app:  Flask application instance
        soul: vapl.ProvenanceSoul — the server's persistent identity
    """
    try:
        from vapl import issue_interaction_vc
    except ImportError:
        log.warning(
            "vapl-py not installed — VAPL middleware disabled. "
            "Run: pip install vapl-py"
        )
        return

    @app.after_request
    def _vapl_issue(response: Any) -> Any:  # type: ignore[return]
        """Issue and attach a VAPL VC for 2xx responses on premium paths."""
        try:
            from flask import request  # local import to avoid top-level dep

            # Only attach VCs to successful responses
            if response.status_code < 200 or response.status_code >= 300:
                return response

            path = request.path
            interaction_type = _interaction_type_for_path(path)

            # Determine agent wallet from request (set by 402Proof decorator)
            agent_wallet = (
                getattr(request, "vapl_agent_wallet", None)
                or request.headers.get("X-Agent-Wallet", "")
                or request.args.get("agent_wallet", "")
            )
            subject_did = agent_wallet if agent_wallet.startswith("did:") else soul.did

            vc = issue_interaction_vc(
                soul=soul,
                subject_did=subject_did,
                interaction_type=interaction_type,
                endpoint_id=f"{request.host_url.rstrip('/')}{path}",
                provider_did=soul.did,
                outcome="success",
                metadata={
                    "method": request.method,
                    "status": response.status_code,
                },
            )

            vc_json = json.dumps(vc, separators=(",", ":"))
            vc_b64 = _b64url(vc_json.encode())

            response.headers["X-VAPL-VC"]     = vc_b64
            response.headers["X-VAPL-Issuer"] = soul.did
            response.headers["X-VAPL-VC-ID"]  = vc.get("id", "")
        except Exception as exc:
            # Never let VC issuance break a real response
            log.warning("VAPL VC issuance failed (non-fatal): %s", exc)

        return response

    log.info("VAPL middleware installed — issuer DID: %s", soul.did)


# ---------------------------------------------------------------------------
# Standalone demo
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    try:
        from flask import Flask, jsonify
        from vapl import generate_soul
    except ImportError as exc:
        print(f"Missing dep: {exc}")
        sys.exit(1)

    soul = generate_soul()
    app = Flask(__name__)
    install_vapl_middleware(app, soul)

    @app.route("/api/council", methods=["GET"])
    def mock_council():
        return jsonify({"verdict": "BUY", "confidence": 0.88})

    @app.route("/api/scan", methods=["GET"])
    def mock_scan():
        return jsonify({"candidates": []})

    print(f"Demo running on http://localhost:5555  |  Issuer: {soul.did}")
    app.run(port=5555, debug=False)
