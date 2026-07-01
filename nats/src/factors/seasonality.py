"""Seasonality / calendar-effect factors. Deterministic from the calendar,
computed for bar `t` using only the date of bar `t` itself, so no `.shift(1)`
is needed for lookahead purposes — the calendar date of the current bar is
always known in advance and is not derived from price/volume data. Values
are still returned aligned to the index used to score bar `t`'s open.
"""

from __future__ import annotations

import pandas as pd


def day_of_week_effect(index: pd.DatetimeIndex, positive_days: tuple[int, ...] = (0, 4), negative_days: tuple[int, ...] = (1,)) -> pd.Series:
    """+1 on historically positive days (default Mon/Fri), -1 on negative (default Tue), else 0.

    Day thresholds must be re-validated against the live backtest window,
    not assumed — see docs/API_REFERENCE.md.
    """
    dow = pd.Series(index.dayofweek, index=index)
    out = pd.Series(0, index=index, dtype=float)
    out[dow.isin(positive_days)] = 1.0
    out[dow.isin(negative_days)] = -1.0
    return out


def turn_of_month(index: pd.DatetimeIndex, window: int = 3) -> pd.Series:
    """1.0 within `window` calendar days of month start/end, else 0.0."""
    days_in_month = index.days_in_month
    day = index.day
    near_start = day <= window
    near_end = day > (days_in_month - window)
    return pd.Series((near_start | near_end).astype(float), index=index)


def holiday_proximity(index: pd.DatetimeIndex, holidays: pd.DatetimeIndex, window: int = 2) -> pd.Series:
    """1.0 if within `window` trading days of a US market holiday, else 0.0."""
    out = pd.Series(0.0, index=index)
    for h in holidays:
        delta = (index - h).days
        out[(delta.__abs__() <= window)] = 1.0
    return out


def options_expiry(index: pd.DatetimeIndex) -> pd.Series:
    """1.0 on the 3rd Friday of the month (monthly OPEX), else 0.0."""
    is_friday = index.dayofweek == 4
    third_friday_day = (index.day >= 15) & (index.day <= 21)
    return pd.Series((is_friday & third_friday_day).astype(float), index=index)
