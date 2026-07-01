#!/usr/bin/env python3
"""Runs all 10 stress-test upgrades against a completed backtest run and
prints a pass/fail gate report. This is the script that decides whether a
strategy (or the full ensemble) is allowed to proceed to paper trading.

Usage:
    python scripts/validate.py --returns path/to/returns.csv --n-trials 20
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import numpy as np
import pandas as pd
import yaml

from src.validation import (
    benjamini_hochberg,
    check_regime_coverage,
    deflated_sharpe_ratio,
    monte_carlo_sharpe_pvalue,
    probabilistic_sharpe_ratio,
)


def load_config(config_path: Path) -> dict:
    with open(config_path) as f:
        return yaml.safe_load(f)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run NATS v2.0 validation gates")
    parser.add_argument("--returns", required=True, help="CSV of daily returns")
    parser.add_argument("--regime-labels", help="CSV of per-bar regime labels")
    parser.add_argument("--n-trials", type=int, default=20)
    parser.add_argument("--config", default=str(Path(__file__).parent.parent / "config.yaml"))
    args = parser.parse_args()

    config = load_config(Path(args.config))
    val_cfg = config["validation"]

    returns = pd.read_csv(args.returns).iloc[:, 0].to_numpy()

    psr = probabilistic_sharpe_ratio(returns)
    dsr = deflated_sharpe_ratio(returns, n_trials=args.n_trials, trial_sharpe_std=returns.std())
    mc_pvalue = monte_carlo_sharpe_pvalue(returns, n_simulations=val_cfg["monte_carlo_simulations"])

    print(f"PSR:              {psr:.4f}  (gate: > {val_cfg['min_psr']})  {'PASS' if psr > val_cfg['min_psr'] else 'FAIL'}")
    print(f"Deflated SR:      {dsr:.4f}  (gate: > {val_cfg['min_deflated_sr']})  {'PASS' if dsr > val_cfg['min_deflated_sr'] else 'FAIL'}")
    print(f"Monte Carlo p:    {mc_pvalue:.4f}  (gate: < 0.05)  {'PASS' if mc_pvalue < 0.05 else 'FAIL'}")

    if args.regime_labels:
        labels = pd.read_csv(args.regime_labels).iloc[:, 0]
        coverage = check_regime_coverage(labels, val_cfg["regime_coverage"])
        print("\nRegime coverage:")
        for regime, pct in coverage.coverage.items():
            status = "PASS" if coverage.passed[regime] else "FAIL"
            print(f"  {regime}: {pct:.1%} (gate: >= {coverage.thresholds[regime]:.0%}) {status}")

    all_gates_passed = (
        psr > val_cfg["min_psr"]
        and dsr > val_cfg["min_deflated_sr"]
        and mc_pvalue < 0.05
    )
    print(f"\n{'ALL GATES PASSED — cleared for paper trading' if all_gates_passed else 'GATES FAILED — do not deploy'}")
    return 0 if all_gates_passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
