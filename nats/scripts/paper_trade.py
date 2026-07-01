#!/usr/bin/env python3
"""Live paper trading loop (spec non-negotiable #1: minimum 90 days paper
before any real capital). Runs the same agent/ensemble/risk pipeline as
backtest.py but against live market data and Alpaca's paper endpoint,
looping once per trading day.

Scaffold stub — requires src/data/*, src/execution/alpaca_adapter.py, and
src/risk/risk_engine.py to be implemented (Phase 3).
"""

from __future__ import annotations

import argparse
import os


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the NATS v2.0 paper trading loop")
    parser.add_argument("--dry-run", action="store_true", help="Compute signals without submitting orders")
    args = parser.parse_args()

    if not os.getenv("ALPACA_PAPER", "true").lower() == "true":
        raise RuntimeError(
            "ALPACA_PAPER must be 'true' — spec non-negotiable #1 requires 90 days "
            "of paper trading before any live capital is deployed. This script "
            "refuses to run against a live account."
        )

    raise NotImplementedError(
        "scripts/paper_trade.py is a scaffold stub. Phase 3 work: build the daily "
        "loop (pull live data -> factors -> agents -> ensemble -> risk gate -> "
        "execution/alpaca_adapter.py), with every decision logged via "
        "src/monitoring/audit_log.py."
    )


if __name__ == "__main__":
    raise SystemExit(main())
