"""Beast Oracle Multi-Symbol Strategist.

Uses the free /api/oracle endpoint to get a multi-symbol composite
directive, synthesizes a cross-market signal, and lists it on Alpha Mesh.
"""
from __future__ import annotations
import logging
import os
import time
import requests
import core

log = logging.getLogger("beast_vapl.oracle")

NAME    = "ORACLE"
SYMBOLS = ["IWM", "SPY", "QQQ", "GME", "NVDA", "TSLA"]


def execute(soul: dict, vcs: list) -> tuple[dict, str | None]:
    wallet = os.environ.get("AGENT_XRPL_ADDRESS", "")

    # Fetch oracle batch (free endpoint)
    log.info("Fetching oracle multi-symbol batch...")
    oracle_data: dict = {}
    try:
        resp = requests.get(f"{core.SQUEEZEOS_BASE}/api/oracle", timeout=30)
        if resp.ok:
            oracle_data = resp.json()
            vcs.append(core.issue_interaction_vc(
                soul, soul["did"], "OracleFetch",
                f"{core.SQUEEZEOS_BASE}/api/oracle", "success",
            ))
            log.info("Oracle data: %s", str(oracle_data)[:200])
        else:
            log.warning("Oracle fetch failed: %d", resp.status_code)
    except Exception as exc:
        log.warning("Oracle error: %s", exc)

    # Also fetch individual previews for each symbol
    symbol_signals: list[dict] = []
    for sym in SYMBOLS:
        try:
            r = requests.get(f"{core.SQUEEZEOS_BASE}/api/preview/{sym}", timeout=15)
            if r.ok:
                d = r.json()
                d["symbol"] = sym
                symbol_signals.append(d)
        except Exception:
            pass

    if not symbol_signals:
        log.warning("No symbol data — aborting oracle strategy")
        return {}, None

    # Voting: count BUY/SELL/HOLD across all symbols
    votes: dict[str, int] = {}
    for s in symbol_signals:
        b = s.get("bias", "NEUTRAL")
        votes[b] = votes.get(b, 0) + 1

    consensus_bias = max(votes, key=lambda k: votes[k])
    avg_confidence = sum(
        float(str(s.get("confidence", 0) or 0)) for s in symbol_signals
    ) / len(symbol_signals)

    log.info("Oracle consensus: %s conf=%.1f (votes=%s)", consensus_bias, avg_confidence, votes)

    signal_id = f"vapl:oracle:{int(time.time())}"
    vcs.append(core.issue_accuracy_vc(
        soul, soul["did"], signal_id, consensus_bias, "pending", avg_confidence / 100.0,
    ))

    # Detailed breakdown for thesis
    breakdown = " | ".join(
        f"{s['symbol']}:{s.get('bias','?')}({float(str(s.get('confidence',0) or 0)):.0f}%)"
        for s in symbol_signals
    )
    thesis = (
        f"Beast Swarm Oracle composite signal — cross-market consensus: "
        f"{consensus_bias} ({avg_confidence:.0f}% avg confidence). "
        f"Symbol breakdown: [{breakdown}]. "
        f"Vote distribution: {votes}. "
        f"SqueezeOS OracleEngine multi-signal aggregation. VAPL-attested."
    )

    listing_id = core.marketplace_list(
        wallet, "MULTI", consensus_bias, avg_confidence, thesis,
        signal_type="TREND", ttl_hours=12,
    )
    if listing_id:
        vcs.append(core.issue_interaction_vc(
            soul, soul["did"], "MarketplaceListing",
            f"{core.SQUEEZEOS_BASE}/api/marketplace/list", "success",
        ))

    return {
        "bias": consensus_bias,
        "confidence": avg_confidence,
        "symbol": "MULTI",
        "votes": votes,
    }, listing_id
