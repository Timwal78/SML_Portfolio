"""Beast GME/AMC Squeeze Specialist.

Fetches free previews for GME and AMC, picks the stronger signal,
escalates to paid council only if confidence exceeds threshold,
lists squeeze thesis on Alpha Mesh.
"""
from __future__ import annotations
import logging
import os
import time
import requests
import core

log = logging.getLogger("beast_vapl.gme")

NAME    = "GME"
SYMBOLS = ["GME", "AMC", "MSTR", "HOOD"]


def execute(soul: dict, vcs: list) -> tuple[dict, str | None]:
    wallet = os.environ.get("AGENT_XRPL_ADDRESS", "")

    # Fetch free previews for all meme/squeeze symbols
    signals: list[dict] = []
    for sym in SYMBOLS:
        try:
            resp = requests.get(
                f"{core.SQUEEZEOS_BASE}/api/preview/{sym}", timeout=20,
            )
            if resp.ok:
                data = resp.json()
                data["symbol"] = sym
                signals.append(data)
                vcs.append(core.issue_interaction_vc(
                    soul, soul["did"], "SignalPreviewFetch",
                    f"{core.SQUEEZEOS_BASE}/api/preview/{sym}", "success",
                ))
        except Exception as exc:
            log.warning("Preview %s failed: %s", sym, exc)

    if not signals:
        log.warning("All previews failed — aborting")
        return {}, None

    # Pick highest-confidence signal
    best = max(signals, key=lambda s: float(str(s.get("confidence", 0) or 0)))
    sym  = best.get("symbol", "GME")
    conf = float(str(best.get("confidence", 0) or 0))
    bias = best.get("bias", "NEUTRAL")

    log.info("Best signal: %s %s conf=%.1f", sym, bias, conf)

    # Escalate to paid council if confidence is borderline
    if conf < 55:
        log.info("Confidence %.1f < 55 — requesting council for %s", conf, sym)
        bias, conf = core.get_council_verdict(soul, sym, vcs)

    if not bias or bias == "NEUTRAL" or conf < 30:
        log.info("%s signal neutral/weak — not listing", sym)
        return {"bias": bias, "confidence": conf, "symbol": sym}, None

    signal_id = f"vapl:{sym.lower()}:{int(time.time())}"
    vcs.append(core.issue_accuracy_vc(
        soul, soul["did"], signal_id, bias, "pending", conf / 100.0,
    ))

    # Build thesis across all signals for context richness
    context = ", ".join(
        f"{s['symbol']}:{s.get('bias','?')}({float(str(s.get('confidence',0) or 0)):.0f}%)"
        for s in signals
    )
    thesis = (
        f"Beast Swarm GME/squeeze specialist — {sym} primary signal: {bias} "
        f"with {conf:.0f}% confidence. Multi-symbol squeeze scan context: [{context}]. "
        f"SqueezeOS Reg SHO / FTD pressure analysis. VAPL-attested "
        f"Ed25519-signed institutional squeeze signal."
    )

    listing_id = core.marketplace_list(
        wallet, sym, bias, conf, thesis, signal_type="SQUEEZE",
    )
    if listing_id:
        vcs.append(core.issue_interaction_vc(
            soul, soul["did"], "MarketplaceListing",
            f"{core.SQUEEZEOS_BASE}/api/marketplace/list", "success",
        ))

    return {"bias": bias, "confidence": conf, "symbol": sym}, listing_id
