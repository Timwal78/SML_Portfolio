"""Beast IWM 0DTE Specialist — flagship signal agent.

Fetches IWM preview (free), escalates to paid council verdict,
lists the institutional-grade signal on Alpha Mesh marketplace.
"""
from __future__ import annotations
import logging
import os
import time
import requests
import core

log = logging.getLogger("beast_vapl.iwm")

NAME   = "IWM"
SYMBOL = "IWM"


def execute(soul: dict, vcs: list) -> tuple[dict, str | None]:
    wallet = os.environ.get("AGENT_XRPL_ADDRESS", "")

    # Free preview
    log.info("Fetching IWM preview...")
    try:
        preview_resp = requests.get(
            f"{core.SQUEEZEOS_BASE}/api/preview/IWM", timeout=30,
        )
        preview = preview_resp.json() if preview_resp.ok else {}
        status  = "success" if preview_resp.ok else "error"
    except Exception as exc:
        log.warning("Preview failed: %s", exc)
        preview = {}
        status  = "error"

    vcs.append(core.issue_interaction_vc(
        soul, soul["did"], "SignalPreviewFetch",
        f"{core.SQUEEZEOS_BASE}/api/preview/IWM", status,
    ))

    # Always get paid council for IWM — it's the flagship product
    log.info("Requesting paid IWM council verdict...")
    bias, confidence = core.get_council_verdict(soul, "IWM", vcs)

    if not bias or bias == "NEUTRAL" or confidence < 35:
        log.info("IWM signal weak (conf=%.1f) — not listing", confidence)
        return {"bias": bias, "confidence": confidence, "symbol": SYMBOL}, None

    # AccuracyVC for this prediction
    signal_id = f"vapl:iwm:{int(time.time())}"
    vcs.append(core.issue_accuracy_vc(
        soul, soul["did"], signal_id, bias, "pending", confidence / 100.0,
    ))

    thesis = (
        f"IWM 0DTE institutional signal: {bias} directive with {confidence:.0f}% "
        f"aggregate confidence from SqueezeOS multi-engine council (gamma walls, "
        f"options flow, squeeze pressure, regime detection). Beast Swarm IWM "
        f"specialist — VAPL-attested, Ed25519-signed, verifiable on-chain."
    )

    listing_id = core.marketplace_list(
        wallet, SYMBOL, bias, confidence, thesis, signal_type="SQUEEZE",
    )
    if listing_id:
        vcs.append(core.issue_interaction_vc(
            soul, soul["did"], "MarketplaceListing",
            f"{core.SQUEEZEOS_BASE}/api/marketplace/list", "success",
        ))

    return {"bias": bias, "confidence": confidence, "symbol": SYMBOL}, listing_id
