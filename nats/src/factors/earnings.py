"""Earnings factors. All outputs are `.shift(1)`'d — see package docstring.

Constraint (spec Agent 13): must key off the announced earnings date, not
the report/fiscal period date, and shift by at least 1 bar so the signal is
only usable on the bar *after* the print. `eps_actual`/`eps_estimate`/
`announced_date` come from `data/alpha_vantage_client.py`.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def eps_surprise_magnitude(eps_actual: pd.Series, eps_estimate: pd.Series) -> pd.Series:
    surprise = (eps_actual - eps_estimate) / eps_estimate.abs()
    return surprise.shift(1)


def eps_surprise_direction(eps_actual: pd.Series, eps_estimate: pd.Series) -> pd.Series:
    direction = np.sign(eps_actual - eps_estimate)
    return direction.shift(1)


def analyst_revision_velocity(analyst_estimate_series: pd.Series, n: int = 5) -> pd.Series:
    """Rate of change of the consensus estimate itself (revisions accelerating up/down)."""
    return analyst_estimate_series.diff(n).shift(1)


def post_earnings_drift_window(announced_date: pd.Timestamp, index: pd.DatetimeIndex, drift_days: int = 20) -> pd.Series:
    """1.0 for the `drift_days` trading bars following an announced earnings date, else 0.0."""
    days_since = (index - announced_date).days
    in_window = (days_since >= 1) & (days_since <= drift_days)
    return pd.Series(in_window.astype(float), index=index)
