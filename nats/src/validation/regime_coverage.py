"""Regime coverage gate (spec UPGRADE 10).

Before live deployment, validate that the backtest window contains a
minimum fraction of bars in each required regime. Failing any check means
extend the backtest window — never deploy on an unrepresentative sample.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd


@dataclass
class RegimeCoverageResult:
    coverage: dict[str, float]
    thresholds: dict[str, float]
    passed: dict[str, bool]

    @property
    def all_passed(self) -> bool:
        return all(self.passed.values())


DEFAULT_THRESHOLDS = {
    "bull_market": 0.20,
    "bear_market": 0.15,
    "high_volatility": 0.15,
    "crisis": 0.05,
}


def check_regime_coverage(
    regime_labels: pd.Series,
    thresholds: dict[str, float] | None = None,
) -> RegimeCoverageResult:
    thresholds = thresholds or DEFAULT_THRESHOLDS
    total = len(regime_labels)
    if total == 0:
        raise ValueError("regime_labels is empty")

    coverage = {
        label: float((regime_labels == label).sum()) / total for label in thresholds
    }
    passed = {label: coverage[label] >= thresholds[label] for label in thresholds}
    return RegimeCoverageResult(coverage=coverage, thresholds=thresholds, passed=passed)
