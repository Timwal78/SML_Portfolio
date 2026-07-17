"""Credit factors. All outputs are `.shift(1)`'d — see package docstring."""

from __future__ import annotations

import pandas as pd


def hyg_lqd_spread(hyg_close: pd.Series, lqd_close: pd.Series, n: int = 20) -> pd.Series:
    spread = hyg_close / lqd_close
    mean = spread.rolling(n).mean()
    std = spread.rolling(n).std()
    z = (spread - mean) / std
    return z.shift(1)


def credit_equity_divergence(hyg_close: pd.Series, lqd_close: pd.Series, equity_close: pd.Series, n: int = 10) -> pd.Series:
    credit_ret = (hyg_close / lqd_close).pct_change(n)
    equity_ret = equity_close.pct_change(n)
    divergence = credit_ret - equity_ret
    return divergence.shift(1)


def junk_bond_momentum(hyg_close: pd.Series, n: int = 10) -> pd.Series:
    return hyg_close.pct_change(n).shift(1)
