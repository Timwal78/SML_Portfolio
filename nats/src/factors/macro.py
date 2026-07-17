"""Macro factors. All outputs are `.shift(1)`'d — see package docstring.

Inputs are pre-fetched series from `data/alpha_vantage_client.py` (Treasury
yields, Fed funds futures, breakeven inflation). This module only implements
the transform, not the fetch.
"""

from __future__ import annotations

import pandas as pd


def yield_curve_slope(yield_10y: pd.Series, yield_2y: pd.Series) -> pd.Series:
    slope = yield_10y - yield_2y
    return slope.shift(1)


def fed_funds_futures_proxy(fed_funds_rate: pd.Series, futures_implied_rate: pd.Series) -> pd.Series:
    """Spread between market-implied future rate and current effective rate."""
    spread = futures_implied_rate - fed_funds_rate
    return spread.shift(1)


def inflation_breakeven_proxy(nominal_10y: pd.Series, tips_10y: pd.Series) -> pd.Series:
    breakeven = nominal_10y - tips_10y
    return breakeven.shift(1)
