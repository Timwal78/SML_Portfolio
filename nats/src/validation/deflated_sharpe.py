"""Deflated Sharpe Ratio (Bailey & Lopez de Prado, 2014).

Adjusts the PSR benchmark for the number of independent strategy trials
(`n_trials`) to correct for multiple-testing / selection bias — i.e. the
Sharpe you'd expect from the best of N random strategies by chance alone.
Spec UPGRADE 9: n_trials=20 (the swarm size), Deflated SR > 0.90 required
before live deployment.
"""

from __future__ import annotations

import numpy as np
from scipy.stats import norm

from src.validation.psr import probabilistic_sharpe_ratio


def expected_max_sharpe_from_trials(n_trials: int, trial_sharpe_std: float) -> float:
    """Expected maximum Sharpe ratio among `n_trials` independent random
    strategies with Sharpe std `trial_sharpe_std` (approximation from
    Bailey & Lopez de Prado, using the expected value of a Gumbel-type
    extreme order statistic).
    """
    if n_trials < 1:
        raise ValueError("n_trials must be >= 1")
    if n_trials == 1:
        return 0.0
    euler_mascheroni = 0.5772156649
    expected_max = trial_sharpe_std * (
        (1 - euler_mascheroni) * norm.ppf(1 - 1.0 / n_trials)
        + euler_mascheroni * norm.ppf(1 - 1.0 / (n_trials * np.e))
    )
    return float(expected_max)


def deflated_sharpe_ratio(
    returns: np.ndarray,
    n_trials: int,
    trial_sharpe_std: float,
) -> float:
    """DSR = PSR evaluated against the expected-max-Sharpe-by-chance benchmark."""
    benchmark = expected_max_sharpe_from_trials(n_trials, trial_sharpe_std)
    return probabilistic_sharpe_ratio(returns, sharpe_benchmark=benchmark)
