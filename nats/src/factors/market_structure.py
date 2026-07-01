"""Market-structure factors. All outputs are `.shift(1)`'d — see package docstring.

Inputs are pre-fetched from `data/sec_edgar_client.py` (FTD reports, public,
~2-week reporting lag — must be joined on report date, not trade date) and
`data/finra_client.py` (bimonthly short interest reports).
"""

from __future__ import annotations

import pandas as pd


def ftd_zscore(ftd_shares: pd.Series, n: int = 90) -> pd.Series:
    mean = ftd_shares.rolling(n).mean()
    std = ftd_shares.rolling(n).std()
    z = (ftd_shares - mean) / std
    return z.shift(1)


def etf_basket_divergence(etf_short_interest_pct: pd.Series, weighted_holdings_short_pct: pd.Series) -> pd.Series:
    """Spec Agent 20: ETF short interest vs weighted-average short interest of its holdings."""
    divergence = (etf_short_interest_pct - weighted_holdings_short_pct) / weighted_holdings_short_pct
    return divergence.shift(1)


def short_interest_vs_ftd_gap(short_interest: pd.Series, ftd_shares: pd.Series, n: int = 20) -> pd.Series:
    """Flags hidden exposure: short interest flat/declining while price declines and FTDs persist."""
    si_change = short_interest.pct_change(n)
    ftd_level = ftd_shares.rolling(n).mean()
    gap = ftd_level - si_change
    return gap.shift(1)
