"""Probabilistic Sharpe Ratio (Bailey & Lopez de Prado, 2012).

PSR estimates the probability that the true Sharpe ratio exceeds a
benchmark, correcting for skewness, kurtosis, and finite sample size.
Spec UPGRADE 8: PSR > 0.95 required before live deployment.
"""

from __future__ import annotations

import numpy as np
from scipy.stats import norm, skew, kurtosis


def probabilistic_sharpe_ratio(
    returns: np.ndarray,
    sharpe_benchmark: float = 0.0,
) -> float:
    """Returns PSR in [0, 1] — probability the observed Sharpe exceeds `sharpe_benchmark`."""
    returns = np.asarray(returns, dtype=float)
    returns = returns[~np.isnan(returns)]
    n = len(returns)
    if n < 2:
        raise ValueError("Need at least 2 return observations to compute PSR")

    sr = returns.mean() / returns.std(ddof=1) if returns.std(ddof=1) > 0 else 0.0
    skewness = skew(returns)
    kurt = kurtosis(returns, fisher=False)  # non-excess (normal = 3)

    sr_std_err = np.sqrt(
        (1 - skewness * sr + ((kurt - 1) / 4) * sr**2) / (n - 1)
    )
    if sr_std_err <= 0 or np.isnan(sr_std_err):
        return 0.0

    z = (sr - sharpe_benchmark) / sr_std_err
    return float(norm.cdf(z))
