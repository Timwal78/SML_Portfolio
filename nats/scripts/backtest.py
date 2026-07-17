#!/usr/bin/env python3
"""Full 5-year backtest runner (spec UPGRADE 1: 2018-01-01 to 2024-12-31,
min 1250 bars, covering COVID crash / 2022 bear / rate cycle).

Orchestrates: data/ ingestion -> factors/ (shift(1) enforced) ->
agents/ (20 signals) -> regime/ (expanding-window labeling) ->
ensemble/ (meta-learning weights) -> validation/ (PSR/DSR/MC/coverage).

Scaffold stub — wire real data clients and agent logic during Phase 1/2.
"""

from __future__ import annotations

import argparse
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the NATS v2.0 full backtest")
    parser.add_argument("--start", default="2018-01-01")
    parser.add_argument("--end", default="2024-12-31")
    parser.add_argument("--config", default=str(Path(__file__).parent.parent / "config.yaml"))
    parser.add_argument("--out", default="backtest_results.csv")
    args = parser.parse_args()

    raise NotImplementedError(
        "scripts/backtest.py is a scaffold stub. Phase 1/2 work: wire "
        "src/data/* clients to fetch OHLCV for the backtest window, run "
        "src/factors/* -> src/agents/* -> src/regime/* -> src/ensemble/*, "
        "write per-bar results to --out, then run scripts/validate.py "
        "against the output before any paper/live trading."
    )


if __name__ == "__main__":
    raise SystemExit(main())
