"""Dark pool / ATS factors. All outputs are `.shift(1)`'d — see package docstring.

Inputs are pre-fetched from `data/finra_client.py` (FINRA ATS transparency
reports, public). This module only implements the transform, not the fetch.
"""

from __future__ import annotations

import pandas as pd


def ats_volume_pct(ats_volume: pd.Series, total_volume: pd.Series) -> pd.Series:
    pct = ats_volume / total_volume
    return pct.shift(1)


def dark_pool_ratio_vs_mean(ats_volume: pd.Series, total_volume: pd.Series, n: int = 90) -> pd.Series:
    pct = ats_volume / total_volume
    mean_90d = pct.rolling(n).mean()
    ratio = pct / mean_90d
    return ratio.shift(1)


def lit_dark_divergence(lit_volume: pd.Series, dark_volume: pd.Series, n: int = 10) -> pd.Series:
    lit_mom = lit_volume.pct_change(n)
    dark_mom = dark_volume.pct_change(n)
    divergence = dark_mom - lit_mom
    return divergence.shift(1)
