"""Beast VAPL Swarm — strategy dispatcher.

Reads STRATEGY env var and runs the corresponding specialist agent.
All agents share the same core loop: load soul → execute strategy →
issue contribution VC → submit VCs to registry → check and withdraw earnings.

Strategies:
  IWM    — IWM 0DTE institutional signal specialist
  GME    — GME/AMC/meme squeeze specialist
  ORACLE — Multi-symbol oracle cross-market synthesis
  FTD    — Reg SHO / FTD anomaly scanner
  ARBI   — Alpha Mesh arbitrageur (buys from peers, resells composite)

Env vars (per-agent):
  STRATEGY           — which strategy to run (default: IWM)
  AGENT_XRPL_SEED    — XRPL wallet seed for RLUSD payments
  AGENT_XRPL_ADDRESS — XRPL wallet address
  VAPL_SOUL_B64      — base64url(json) persistent ProvenanceSoul
  ANTHROPIC_API_KEY  — Claude reasoning (optional)
  DRY_RUN            — if 'true', skip registry submission

Shared:
  SQUEEZEOS_BASE_URL  — default: https://squeezeos-api.onrender.com
  PROOF402_SERVER_URL — default: https://four02proof.onrender.com
  VAPL_REGISTRY_URL   — default: https://vapl-registry.onrender.com
"""
from __future__ import annotations

import importlib
import logging
import os
import sys

# Ensure beast_agent directory is importable so strategy files can `import core`
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import core  # noqa: E402 — must come after sys.path setup

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(name)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("beast_vapl")

_STRATEGIES = {
    "IWM":    "strategy_iwm",
    "GME":    "strategy_gme",
    "ORACLE": "strategy_oracle",
    "FTD":    "strategy_ftd",
    "ARBI":   "strategy_arbi",
}


def main() -> None:
    strategy_name = os.environ.get("STRATEGY", "IWM").upper()

    log.info(
        "Beast VAPL Swarm — strategy=%s dry_run=%s",
        strategy_name, os.environ.get("DRY_RUN", "false"),
    )

    if strategy_name not in _STRATEGIES:
        log.error("Unknown strategy '%s'. Valid: %s", strategy_name, list(_STRATEGIES))
        sys.exit(1)

    # Load or generate agent soul
    soul = core.load_soul()
    log.info("Agent DID: %s", soul["did"])

    # Execute strategy
    mod      = importlib.import_module(_STRATEGIES[strategy_name])
    vcs: list = []

    try:
        signal_data, listing_id = mod.execute(soul, vcs)
        log.info(
            "Strategy %s complete — %d VCs issued, listing=%s",
            strategy_name, len(vcs), listing_id or "none",
        )
    except Exception as exc:
        log.error("Strategy %s crashed: %s", strategy_name, exc, exc_info=True)
        signal_data, listing_id = {}, None

    # Contribution VC for this swarm run
    vcs.append(core.issue_contribution_vc(soul, strategy_name, len(vcs)))

    # Submit all VCs to the VAPL registry
    log.info("Submitting %d VCs to registry...", len(vcs))
    core.submit_all(vcs)

    # Check balance and withdraw earnings above threshold
    log.info("Checking marketplace earnings...")
    result = core.check_and_withdraw(soul)
    if result:
        log.info(
            "Withdrew %.4f RLUSD → tx=%s",
            result.get("amount_rlusd", 0),
            str(result.get("tx_hash", "?"))[:20],
        )

    log.info("Beast VAPL Swarm run complete — strategy=%s", strategy_name)


if __name__ == "__main__":
    main()
