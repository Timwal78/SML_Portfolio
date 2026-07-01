"""Mean-reversion factors. All outputs are `.shift(1)`'d — see package docstring."""

from __future__ import annotations

import pandas as pd


def rsi_14(close: pd.Series, n: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(n).mean()
    loss = (-delta.clip(upper=0)).rolling(n).mean()
    rs = gain / loss.replace(0, pd.NA)
    rsi = 100 - (100 / (1 + rs))
    return rsi.shift(1)


def williams_r(high: pd.Series, low: pd.Series, close: pd.Series, n: int = 14) -> pd.Series:
    highest_high = high.rolling(n).max()
    lowest_low = low.rolling(n).min()
    wr = -100 * (highest_high - close) / (highest_high - lowest_low)
    return wr.shift(1)


def bollinger_position(close: pd.Series, n: int = 20, n_std: float = 2.0) -> pd.Series:
    """Position of price within the bands, in [0, 1] (0.5 = at the mean)."""
    mid = close.rolling(n).mean()
    std = close.rolling(n).std()
    upper = mid + n_std * std
    lower = mid - n_std * std
    pos = (close - lower) / (upper - lower)
    return pos.shift(1)


def bollinger_width(close: pd.Series, n: int = 20, n_std: float = 2.0) -> pd.Series:
    mid = close.rolling(n).mean()
    std = close.rolling(n).std()
    width = (2 * n_std * std) / mid
    return width.shift(1)


def z_score(close: pd.Series, n: int = 20) -> pd.Series:
    mean = close.rolling(n).mean()
    std = close.rolling(n).std()
    z = (close - mean) / std
    return z.shift(1)
