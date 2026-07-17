"""Beast FTD Anomaly Specialist.

Uses the free /api/ftd/alerts endpoint (ShortSqueeze Swarm — 15min scan)
to detect Reg SHO / FTD anomalies and list them on Alpha Mesh.
"""
from __future__ import annotations
import logging
import os
import time
import requests
import core

log = logging.getLogger("beast_vapl.ftd")

NAME = "FTD"


def execute(soul: dict, vcs: list) -> tuple[dict, str | None]:
    wallet = os.environ.get("AGENT_XRPL_ADDRESS", "")

    # Fetch FTD alert feed (free)
    log.info("Fetching FTD anomaly alerts...")
    alerts: list[dict] = []
    try:
        resp = requests.get(f"{core.SQUEEZEOS_BASE}/api/ftd/alerts", timeout=30)
        if resp.ok:
            data   = resp.json()
            alerts = data if isinstance(data, list) else data.get("alerts", [])
            vcs.append(core.issue_interaction_vc(
                soul, soul["did"], "FTDAlertFetch",
                f"{core.SQUEEZEOS_BASE}/api/ftd/alerts", "success",
            ))
            log.info("FTD alerts: %d anomalies", len(alerts))
        else:
            log.warning("FTD alert fetch failed: %d", resp.status_code)
    except Exception as exc:
        log.warning("FTD fetch error: %s", exc)

    if not alerts:
        log.info("No FTD anomalies detected — fetching GME FTD series as fallback")
        alerts = _fetch_ftd_series("GME", soul, vcs)

    if not alerts:
        log.info("No FTD data available — aborting FTD strategy")
        return {}, None

    # Pick the most significant anomaly (highest FTD count or pressure score)
    best = alerts[0] if alerts else {}
    symbol = best.get("symbol", "GME").upper()

    # Derive signal from FTD pressure
    pressure  = float(str(best.get("ftd_pressure", best.get("pressure", 0)) or 0))
    threshold = float(str(best.get("threshold", 0)) or 0)
    bias      = "BUY" if pressure > threshold * 1.5 else ("HOLD" if pressure > threshold else "NEUTRAL")
    confidence = min(95.0, max(30.0, pressure / max(threshold, 1) * 60))

    log.info("FTD signal: %s %s pressure=%.1f threshold=%.1f", symbol, bias, pressure, threshold)

    signal_id = f"vapl:ftd:{symbol.lower()}:{int(time.time())}"
    vcs.append(core.issue_accuracy_vc(
        soul, soul["did"], signal_id, bias, "pending", confidence / 100.0,
    ))

    n_alerts = len(alerts)
    top_symbols = ", ".join(
        str(a.get("symbol", "?")) for a in alerts[:5]
    )
    thesis = (
        f"Beast Swarm FTD specialist — Reg SHO anomaly signal for {symbol}: "
        f"{bias} with {confidence:.0f}% confidence. "
        f"FTD pressure {pressure:.1f} vs threshold {threshold:.1f} "
        f"({pressure/max(threshold,1)*100:.0f}% of threshold). "
        f"ShortSqueeze Swarm detected {n_alerts} anomalies this scan cycle. "
        f"Top flagged: [{top_symbols}]. "
        f"SEC Reg SHO FTD time-series data from SqueezeOS. VAPL-attested."
    )

    listing_id = core.marketplace_list(
        wallet, symbol, bias, confidence, thesis, signal_type="SQUEEZE",
    )
    if listing_id:
        vcs.append(core.issue_interaction_vc(
            soul, soul["did"], "MarketplaceListing",
            f"{core.SQUEEZEOS_BASE}/api/marketplace/list", "success",
        ))

    return {"bias": bias, "confidence": confidence, "symbol": symbol}, listing_id


def _fetch_ftd_series(symbol: str, soul: dict, vcs: list) -> list:
    """Fallback: fetch FTD series for a single symbol."""
    try:
        resp = requests.get(
            f"{core.SQUEEZEOS_BASE}/api/ftd", timeout=20,
        )
        if resp.ok:
            data = resp.json()
            vcs.append(core.issue_interaction_vc(
                soul, soul["did"], "FTDSeriesFetch",
                f"{core.SQUEEZEOS_BASE}/api/ftd", "success",
            ))
            if isinstance(data, list):
                return data
            if isinstance(data, dict):
                return data.get(symbol, data.get("data", []))
    except Exception as exc:
        log.warning("FTD series fallback failed: %s", exc)
    return []
