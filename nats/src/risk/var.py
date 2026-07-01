"""Value-at-Risk utilities."""

from __future__ import annotations

import numpy as np
import pandas as pd


def historical_var(returns: pd.Series, confidence: float = 0.95) -> float:
    """Historical (non-parametric) VaR: the loss at the given confidence level.
    Returned as a positive number representing the magnitude of the loss.
    """
    if not (0 < confidence < 1):
        raise ValueError("confidence must be in (0, 1)")
    percentile = (1 - confidence) * 100
    var = -np.percentile(returns.dropna(), percentile)
    return float(max(var, 0.0))


def parametric_var(returns: pd.Series, confidence: float = 0.95) -> float:
    """Variance-covariance VaR assuming normally distributed returns."""
    from scipy.stats import norm

    mu = returns.mean()
    sigma = returns.std()
    z = norm.ppf(1 - confidence)
    var = -(mu + z * sigma)
    return float(max(var, 0.0))


def portfolio_var(weights: pd.Series, cov_matrix: pd.DataFrame, confidence: float = 0.95) -> float:
    """Parametric portfolio VaR given position weights and a return covariance matrix."""
    from scipy.stats import norm

    portfolio_variance = float(weights.to_numpy() @ cov_matrix.to_numpy() @ weights.to_numpy())
    portfolio_std = np.sqrt(max(portfolio_variance, 0.0))
    z = norm.ppf(1 - confidence)
    return float(max(-z * portfolio_std, 0.0))
