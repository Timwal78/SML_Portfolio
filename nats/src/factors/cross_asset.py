"""Cross-asset factors. All outputs are `.shift(1)`'d — see package docstring."""

from __future__ import annotations

import pandas as pd


def eq_bond_correlation(equity_close: pd.Series, bond_close: pd.Series, n: int = 20) -> pd.Series:
    eq_ret = equity_close.pct_change()
    bond_ret = bond_close.pct_change()
    corr = eq_ret.rolling(n).corr(bond_ret)
    return corr.shift(1)


def risk_on_score(equity_close: pd.Series, bond_close: pd.Series, gold_close: pd.Series, n: int = 20) -> pd.Series:
    """Composite: equity momentum minus (bond + gold momentum), normalized."""
    eq_mom = equity_close.pct_change(n)
    bond_mom = bond_close.pct_change(n)
    gold_mom = gold_close.pct_change(n)
    score = eq_mom - 0.5 * (bond_mom + gold_mom)
    return score.shift(1)


def flight_to_quality(equity_close: pd.Series, bond_close: pd.Series, n: int = 10) -> pd.Series:
    """Positive when bonds rally while equities fall — classic flight-to-quality signature."""
    eq_ret = equity_close.pct_change(n)
    bond_ret = bond_close.pct_change(n)
    ftq = bond_ret - eq_ret
    return ftq.shift(1)
