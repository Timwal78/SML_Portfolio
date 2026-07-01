"""Validation gates: PSR, Deflated Sharpe, Monte Carlo significance,
purged k-fold CV, multiple-testing correction, and regime coverage.
All ten stress-test upgrades (spec) route through this package before a
strategy or the ensemble is cleared for live deployment.
"""

from src.validation.deflated_sharpe import deflated_sharpe_ratio, expected_max_sharpe_from_trials
from src.validation.monte_carlo import monte_carlo_sharpe_pvalue
from src.validation.multiple_testing import benjamini_hochberg
from src.validation.psr import probabilistic_sharpe_ratio
from src.validation.purged_kfold import PurgedKFold
from src.validation.regime_coverage import RegimeCoverageResult, check_regime_coverage

__all__ = [
    "deflated_sharpe_ratio",
    "expected_max_sharpe_from_trials",
    "monte_carlo_sharpe_pvalue",
    "benjamini_hochberg",
    "probabilistic_sharpe_ratio",
    "PurgedKFold",
    "RegimeCoverageResult",
    "check_regime_coverage",
]
