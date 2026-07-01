"""Microstructure factors. All outputs are `.shift(1)`'d — see package docstring."""

from __future__ import annotations

import numpy as np
import pandas as pd


def intraday_range(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.Series:
    rng = (high - low) / close
    return rng.shift(1)


def close_position(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.Series:
    """Where the close sits within the day's range, in [0, 1]."""
    pos = (close - low) / (high - low)
    return pos.shift(1)


def gap(open_: pd.Series, close: pd.Series) -> pd.Series:
    g = (open_ - close.shift(1)) / close.shift(1)
    return g.shift(1)


def kyles_lambda(close: pd.Series, volume: pd.Series, n: int = 20) -> pd.Series:
    """Rolling-regression price-impact coefficient: |ret_t| regressed on signed dollar volume."""
    ret = close.pct_change()
    signed_dollar_vol = np.sign(ret) * volume * close
    cov = ret.rolling(n).cov(signed_dollar_vol)
    var = signed_dollar_vol.rolling(n).var()
    lam = cov / var
    return lam.shift(1)


def bid_ask_imbalance(bid_size: pd.Series, ask_size: pd.Series) -> pd.Series:
    """(bid_size - ask_size) / (bid_size + ask_size), requires L2 data from Polygon."""
    imbalance = (bid_size - ask_size) / (bid_size + ask_size)
    return imbalance.shift(1)
