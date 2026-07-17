"""Options-flow factors. All outputs are `.shift(1)`'d — see package docstring.

Inputs are pre-fetched options-chain snapshots from `data/tradier_client.py`.
This module only implements the transform, not the fetch.
"""

from __future__ import annotations

import pandas as pd


def put_call_ratio(put_volume: pd.Series, call_volume: pd.Series) -> pd.Series:
    ratio = put_volume / call_volume.replace(0, pd.NA)
    return ratio.shift(1)


def unusual_oi_zscore(open_interest: pd.Series, n: int = 20) -> pd.Series:
    mean = open_interest.rolling(n).mean()
    std = open_interest.rolling(n).std()
    z = (open_interest - mean) / std
    return z.shift(1)


def cost_to_borrow_proxy(put_call_skew: pd.Series, deep_itm_put_iv: pd.Series, atm_call_iv: pd.Series) -> pd.Series:
    """Approximates borrow cost via put-call parity skew — no direct CTB feed on free tiers."""
    proxy = deep_itm_put_iv - atm_call_iv
    return proxy.shift(1)


def synthetic_short_score(itm_put_oi_delta: pd.Series, total_oi: pd.Series) -> pd.Series:
    """Spec Agent 20: (ITM put OI delta) / (total OI). Threshold 0.65 applied by the caller."""
    score = itm_put_oi_delta / total_oi
    return score.shift(1)
