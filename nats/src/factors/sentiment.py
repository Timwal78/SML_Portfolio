"""Sentiment factors. All outputs are `.shift(1)`'d — see package docstring.

`vix_regime` is pure OHLCV math. The news-derived factors require a raw
sentiment score time series from `data/polygon_client.py` (Polygon news
sentiment API) — this module only implements the transform, not the fetch.
"""

from __future__ import annotations

import pandas as pd


def vix_regime(vix_close: pd.Series, n: int = 90) -> pd.Series:
    """Z-score of VIX vs its rolling mean — positive = fear regime."""
    mean = vix_close.rolling(n).mean()
    std = vix_close.rolling(n).std()
    z = (vix_close - mean) / std
    return z.shift(1)


def fear_greed_proxy(vix_close: pd.Series, close: pd.Series, ma_window: int = 200) -> pd.Series:
    """Combines VIX level with price extension above its long moving average."""
    ma = close.rolling(ma_window).mean()
    extension = (close - ma) / ma
    vix_z = (vix_close - vix_close.rolling(ma_window).mean()) / vix_close.rolling(ma_window).std()
    proxy = extension - vix_z
    return proxy.shift(1)


def news_sentiment_level(raw_sentiment: pd.Series, n: int = 5) -> pd.Series:
    """Rolling mean of a raw per-bar sentiment score (from Polygon news API)."""
    return raw_sentiment.rolling(n).mean().shift(1)


def news_sentiment_velocity(raw_sentiment: pd.Series, n: int = 5) -> pd.Series:
    """First derivative (rate of change) of rolling sentiment — the actual Agent 18 signal."""
    level = raw_sentiment.rolling(n).mean()
    return level.diff().shift(1)


def news_sentiment_acceleration(raw_sentiment: pd.Series, n: int = 5) -> pd.Series:
    level = raw_sentiment.rolling(n).mean()
    velocity = level.diff()
    return velocity.diff().shift(1)
