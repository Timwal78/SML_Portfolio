"""Dispersion factors. All outputs are `.shift(1)`'d — see package docstring."""

from __future__ import annotations

import pandas as pd


def pair_spread_zscore(a_close: pd.Series, b_close: pd.Series, n: int = 20) -> pd.Series:
    spread = a_close / b_close
    mean = spread.rolling(n).mean()
    std = spread.rolling(n).std()
    z = (spread - mean) / std
    return z.shift(1)


def momentum_divergence(a_close: pd.Series, b_close: pd.Series, n: int = 10) -> pd.Series:
    div = a_close.pct_change(n) - b_close.pct_change(n)
    return div.shift(1)


def rolling_correlation(a_close: pd.Series, b_close: pd.Series, n: int = 20) -> pd.Series:
    corr = a_close.pct_change().rolling(n).corr(b_close.pct_change())
    return corr.shift(1)
