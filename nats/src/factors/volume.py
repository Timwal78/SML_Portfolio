"""Volume factors. All outputs are `.shift(1)`'d — see package docstring."""

from __future__ import annotations

import numpy as np
import pandas as pd


def obv(close: pd.Series, volume: pd.Series) -> pd.Series:
    direction = np.sign(close.diff()).fillna(0)
    obv_raw = (direction * volume).cumsum()
    return obv_raw.shift(1)


def volume_momentum(volume: pd.Series, n: int = 10) -> pd.Series:
    return volume.pct_change(n).shift(1)


def vwap_deviation(close: pd.Series, volume: pd.Series, n: int = 20) -> pd.Series:
    vwap = (close * volume).rolling(n).sum() / volume.rolling(n).sum()
    dev = (close - vwap) / vwap
    return dev.shift(1)


def amihud_illiquidity(close: pd.Series, volume: pd.Series, dollar_volume: pd.Series | None = None, n: int = 20) -> pd.Series:
    """Amihud (2002) illiquidity ratio: |return| / dollar volume, rolling mean."""
    ret = close.pct_change().abs()
    dvol = dollar_volume if dollar_volume is not None else close * volume
    illiq = (ret / dvol).rolling(n).mean()
    return illiq.shift(1)


def volume_confirmation(close: pd.Series, volume: pd.Series, n: int = 20, spike_std: float = 2.0) -> pd.Series:
    """Boolean-ish factor: 1.0 if today's volume is a >spike_std sigma spike, else 0.0."""
    vol_mean = volume.rolling(n).mean()
    vol_std = volume.rolling(n).std()
    spike = ((volume - vol_mean) / vol_std) > spike_std
    return spike.astype(float).shift(1)
