"""Volatility factors. All outputs are `.shift(1)`'d — see package docstring."""

from __future__ import annotations

import numpy as np
import pandas as pd


def _realized_vol(close: pd.Series, n: int) -> pd.Series:
    log_ret = np.log(close / close.shift(1))
    return log_ret.rolling(n).std().shift(1)


def vol_5d(close: pd.Series) -> pd.Series:
    return _realized_vol(close, 5)


def vol_10d(close: pd.Series) -> pd.Series:
    return _realized_vol(close, 10)


def vol_20d(close: pd.Series) -> pd.Series:
    return _realized_vol(close, 20)


def realized_vol(close: pd.Series, n: int = 20) -> pd.Series:
    return _realized_vol(close, n)


def vol_of_vol(close: pd.Series, vol_window: int = 20, vov_window: int = 20) -> pd.Series:
    """Volatility of the rolling volatility series itself."""
    rv = _realized_vol(close, vol_window)
    return rv.rolling(vov_window).std().shift(1)


def parkinson(high: pd.Series, low: pd.Series, n: int = 20) -> pd.Series:
    """Parkinson (1980) high-low range volatility estimator."""
    hl_ratio = np.log(high / low) ** 2
    factor = 1.0 / (4.0 * np.log(2.0))
    park = np.sqrt((factor * hl_ratio).rolling(n).mean())
    return park.shift(1)
