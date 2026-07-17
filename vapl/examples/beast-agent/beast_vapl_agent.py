#!/usr/bin/env python3
"""
BEAST VAPL Self-Optimizing Agent
=================================
Demonstrates a BEAST-mode market intelligence agent that:
1. Holds a persistent ProvenanceSoul (Ed25519 DID:key identity)
2. Issues VCs for every interaction it performs
3. Reads its own reputation score to self-optimize strategy
4. Contributes to the Alpha Mesh when confidence is high

Prime Directive: NO DEMO DATA. All market data comes from live APIs.
If data is unavailable, the agent waits — it never fabricates signals.
"""

import os
import sys
import time
import json
import logging
import hashlib
import secrets
from datetime import datetime, timezone, timedelta
from typing import Any

# ---------------------------------------------------------------------------
# Attempt to import VAPL SDK; guide on failure
# ---------------------------------------------------------------------------
try:
    from vapl import (
        generate_soul, ProvenanceSoul,
        issue_interaction_vc, issue_accuracy_vc, issue_contribution_vc,
        verify_vc, compute_reputation_score, rank_agents,
        generate_provenance_soul_manifest,
    )
except ImportError:
    print("Install vapl-py first: pip install vapl-py  (or: pip install -e vapl/py-sdk)")
    sys.exit(1)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [BEAST-VAPL] %(levelname)s %(message)s",
)
log = logging.getLogger("beast_vapl")

# ---------------------------------------------------------------------------
# Config from environment — no hardcoded values
# ---------------------------------------------------------------------------
SQUEEZEOS_BASE = os.environ.get("SQUEEZEOS_BASE", "https://squeezeos-api.onrender.com")
PROOF402_BASE  = os.environ.get("PROOF402_BASE",  "https://four02proof.onrender.com")
SOUL_FILE      = os.environ.get("VAPL_SOUL_FILE",  ".beast_soul.json")
TARGET_SYMBOL  = os.environ.get("BEAST_SYMBOL",    "IWM")
TRUST_WINDOW   = int(os.environ.get("BEAST_TRUST_WINDOW_DAYS", "30"))

# ---------------------------------------------------------------------------
# Soul persistence helpers
# ---------------------------------------------------------------------------

def load_or_create_soul() -> ProvenanceSoul:
    """Load soul from disk or generate and persist a fresh one."""
    if os.path.exists(SOUL_FILE):
        with open(SOUL_FILE) as f:
            data = json.load(f)
        soul = ProvenanceSoul.from_dict(data)
        log.info("Loaded existing soul: %s", soul.did)
        return soul

    soul = generate_soul()
    with open(SOUL_FILE, "w") as f:
        json.dump(soul.to_dict(), f, indent=2)
    log.info("Generated new soul: %s", soul.did)
    return soul


# ---------------------------------------------------------------------------
# Live API helpers — raise on unavailability, never fake data
# ---------------------------------------------------------------------------

def fetch_preview(symbol: str) -> dict[str, Any]:
    """GET /api/preview/<symbol> — free endpoint, no payment token needed."""
    import urllib.request
    url = f"{SQUEEZEOS_BASE}/api/preview/{symbol}"
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            return json.loads(resp.read())
    except Exception as exc:
        log.warning("Preview fetch failed: %s", exc)
        return {}


def fetch_history(symbol: str) -> list[dict[str, Any]]:
    """GET /api/history/<symbol> — free signal history."""
    import urllib.request
    url = f"{SQUEEZEOS_BASE}/api/history/{symbol}"
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            return json.loads(resp.read())
    except Exception as exc:
        log.warning("History fetch failed: %s", exc)
        return []


# ---------------------------------------------------------------------------
# Reputation self-check
# ---------------------------------------------------------------------------

def self_reputation(soul: ProvenanceSoul, wallet: list[dict]) -> dict[str, Any]:
    """Compute own reputation from accumulated VCs."""
    score = compute_reputation_score(soul.did, wallet)
    return score


# ---------------------------------------------------------------------------
# Strategy: adapt verbosity/contribution threshold based on reputation tier
# ---------------------------------------------------------------------------

def strategy_from_reputation(score: dict[str, Any]) -> dict[str, Any]:
    composite = score.get("composite", 0.0)
    if composite >= 0.90:
        tier = "Elite"
        contribution_threshold = 0.85   # share signals above this confidence
        poll_interval_s = 60            # check market every minute
    elif composite >= 0.70:
        tier = "Premium"
        contribution_threshold = 0.90
        poll_interval_s = 90
    elif composite >= 0.40:
        tier = "Standard"
        contribution_threshold = 0.95   # very conservative sharing
        poll_interval_s = 180
    else:
        tier = "Basic"
        contribution_threshold = 1.01   # never share (above possible confidence)
        poll_interval_s = 300
    return {
        "tier": tier,
        "composite": composite,
        "contribution_threshold": contribution_threshold,
        "poll_interval_s": poll_interval_s,
    }


# ---------------------------------------------------------------------------
# VC wallet — in-memory for demo; production would persist to DB
# ---------------------------------------------------------------------------

vc_wallet: list[dict[str, Any]] = []


def record(vc: dict[str, Any]) -> None:
    vc_wallet.append(vc)
    log.debug("Recorded VC: %s", vc.get("id"))


# ---------------------------------------------------------------------------
# One analysis cycle
# ---------------------------------------------------------------------------

def analysis_cycle(soul: ProvenanceSoul, symbol: str, strategy: dict) -> None:
    cycle_start = datetime.now(timezone.utc)
    log.info("=== Cycle start | %s | tier=%s ===", symbol, strategy["tier"])

    # 1. Fetch live preview
    preview = fetch_preview(symbol)
    if not preview:
        log.warning("No data available — awaiting live feed")
        return

    bias      = preview.get("bias", "Awaiting Data")
    regime    = preview.get("regime", "Awaiting Data")
    confidence = float(preview.get("confidence", 0.0))

    log.info("Signal: bias=%s regime=%s confidence=%.3f", bias, regime, confidence)

    # 2. Issue InteractionCredential for this fetch
    try:
        interaction_vc = issue_interaction_vc(
            soul=soul,
            subject_did=soul.did,
            interaction_type="SqueezeOSScan",
            endpoint_id=f"{SQUEEZEOS_BASE}/api/preview/{symbol}",
            provider_did=soul.did,  # self-issued for now; in prod this comes from SqueezeOS
            outcome="success",
            metadata={
                "symbol": symbol,
                "bias": bias,
                "regime": regime,
                "confidence": confidence,
            },
        )
        record(interaction_vc)
    except Exception as exc:
        log.error("Failed to issue interaction VC: %s", exc)

    # 3. Evaluate signal quality vs. history for accuracy
    history = fetch_history(symbol)
    if history:
        # Very simple accuracy heuristic: if current bias matches
        # the majority of the last 5 signals, mark as aligned
        recent_biases = [h.get("data", {}).get("bias") for h in history[-5:]]
        recent_biases = [b for b in recent_biases if b]
        if recent_biases:
            majority = max(set(recent_biases), key=recent_biases.count)
            aligned = bias == majority
            accuracy_rate = 1.0 if aligned else 0.5  # simplified

            try:
                accuracy_vc = issue_accuracy_vc(
                    soul=soul,
                    subject_did=soul.did,
                    issuer_soul=soul,
                    measurement_window_start=(
                        cycle_start - timedelta(days=1)
                    ).isoformat(),
                    measurement_window_end=cycle_start.isoformat(),
                    total_predictions=len(recent_biases),
                    correct_predictions=int(len(recent_biases) * accuracy_rate),
                    accuracy_rate=accuracy_rate,
                    methodology="majority_bias_alignment_v1",
                )
                record(accuracy_vc)
                log.info("Accuracy VC issued: rate=%.2f", accuracy_rate)
            except Exception as exc:
                log.error("Failed to issue accuracy VC: %s", exc)

    # 4. Alpha Mesh contribution — only if confidence clears threshold
    if confidence >= strategy["contribution_threshold"]:
        try:
            contribution_vc = issue_contribution_vc(
                soul=soul,
                subject_did=soul.did,
                contribution_type="AlphaMeshSignal",
                contribution_id=f"beast-alpha-{symbol}-{int(time.time())}",
                description=f"{symbol} {bias} signal | regime={regime} | conf={confidence:.3f}",
                quality_score=min(1.0, confidence),
                metadata={"symbol": symbol, "source": "BEAST-VAPL"},
            )
            record(contribution_vc)
            log.info(
                "Alpha Mesh contribution issued (confidence %.3f >= threshold %.3f)",
                confidence, strategy["contribution_threshold"],
            )
        except Exception as exc:
            log.error("Failed to issue contribution VC: %s", exc)
    else:
        log.info(
            "Confidence %.3f below contribution threshold %.3f — not sharing",
            confidence, strategy["contribution_threshold"],
        )

    log.info("Wallet size: %d VCs", len(vc_wallet))


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main() -> None:
    soul = load_or_create_soul()

    # Emit discovery manifest
    manifest = generate_provenance_soul_manifest(
        soul=soul,
        service_name="BEAST-VAPL Agent",
        description="Self-optimizing market intelligence agent with VAPL provenance",
        capabilities=["SqueezeOSScan", "AlphaMeshContribution"],
        reputation_score=None,  # will populate after first cycle
    )
    log.info("Discovery manifest: %s", json.dumps(manifest, indent=2))

    cycles = 0
    while True:
        cycles += 1
        log.info("--- Cycle %d ---", cycles)

        # Compute current reputation (grows with each cycle)
        rep = self_reputation(soul, vc_wallet)
        log.info(
            "Reputation: composite=%.3f accuracy=%.3f reliability=%.3f",
            rep.get("composite", 0),
            rep.get("components", {}).get("accuracy", 0),
            rep.get("components", {}).get("reliability", 0),
        )

        strategy = strategy_from_reputation(rep)
        log.info("Strategy: %s", strategy)

        analysis_cycle(soul, TARGET_SYMBOL, strategy)

        log.info("Sleeping %ds until next cycle", strategy["poll_interval_s"])
        time.sleep(strategy["poll_interval_s"])


if __name__ == "__main__":
    main()
