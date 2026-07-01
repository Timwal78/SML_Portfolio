"""Price momentum factors. All outputs are `.shift(1)`'d — see package docstring."""

from __future__ import annotations

import pandas as pd


def _mom(close: pd.Series, n: int) -> pd.Series:
    return close.pct_change(n).shift(1)


def mom_3d(close: pd.Series) -> pd.Series:
    return _mom(close, 3)


def mom_5d(close: pd.Series) -> pd.Series:
    return _mom(close, 5)


def mom_10d(close: pd.Series) -> pd.Series:
    return _mom(close, 10)


def mom_15d(close: pd.Series) -> pd.Series:
    return _mom(close, 15)


def mom_20d(close: pd.Series) -> pd.Series:
    return _mom(close, 20)


def acceleration(close: pd.Series, short: int = 5, long: int = 20) -> pd.Series:
    """Change in momentum: mom_short - mom_long, both already point-in-time safe."""
    return (_mom(close, short) - _mom(close, long))
