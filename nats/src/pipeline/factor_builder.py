"""Builds the factor frame consumed by the 8 agents implemented for the v1
paper-trading launch (all backed by free Yahoo Finance OHLCV + VIX — see
config.yaml's `paper_trading.implemented_agents`). Extend this as more
agents/data sources come online (Phase 1/2).
"""

from __future__ import annotations

import pandas as pd
from pandas.tseries.holiday import USFederalHolidayCalendar

from src.factors import mean_reversion, momentum, seasonality, sentiment, volatility, volume


def build_factor_frame(ohlcv: pd.DataFrame, vix_close: pd.Series) -> pd.DataFrame:
    """`ohlcv` must have columns open/high/low/close/volume, daily bars.
    `vix_close` is the ^VIX daily close series, reindexed onto `ohlcv`'s
    trading days (forward-filled — VIX and equity calendars are the same
    NYSE sessions, so gaps should be rare).
    """
    close, volume_col = ohlcv["close"], ohlcv["volume"]
    vix_aligned = vix_close.reindex(ohlcv.index).ffill()

    holidays = USFederalHolidayCalendar().holidays(
        start=ohlcv.index.min(), end=ohlcv.index.max() + pd.Timedelta(days=30)
    )

    frame = pd.DataFrame(index=ohlcv.index)

    frame["mom_3d"] = momentum.mom_3d(close)
    frame["mom_5d"] = momentum.mom_5d(close)
    frame["mom_10d"] = momentum.mom_10d(close)
    frame["mom_15d"] = momentum.mom_15d(close)
    frame["mom_20d"] = momentum.mom_20d(close)
    frame["acceleration"] = momentum.acceleration(close)

    frame["rsi_14"] = mean_reversion.rsi_14(close)
    frame["bollinger_position"] = mean_reversion.bollinger_position(close)
    frame["bollinger_width"] = mean_reversion.bollinger_width(close)
    frame["z_score"] = mean_reversion.z_score(close)
    frame["price_extension_vs_200dma"] = mean_reversion.price_extension_vs_200dma(close)

    frame["obv"] = volume.obv(close, volume_col)
    frame["volume_momentum"] = volume.volume_momentum(volume_col)
    frame["vwap_deviation"] = volume.vwap_deviation(close, volume_col)
    frame["volume_confirmation"] = volume.volume_confirmation(close, volume_col)
    frame["amihud_illiquidity"] = volume.amihud_illiquidity(close, volume_col)

    frame["vol_5d"] = volatility.vol_5d(close)
    frame["vol_10d"] = volatility.vol_10d(close)
    frame["vol_20d"] = volatility.vol_20d(close)
    frame["vol_of_vol"] = volatility.vol_of_vol(close)
    frame["vix_momentum"] = volatility.vix_momentum(vix_aligned)
    frame["parkinson"] = volatility.parkinson(ohlcv["high"], ohlcv["low"])

    frame["vix_zscore_90d"] = sentiment.vix_regime(vix_aligned)

    frame["day_of_week_effect"] = seasonality.day_of_week_effect(ohlcv.index)
    frame["turn_of_month"] = seasonality.turn_of_month(ohlcv.index)
    frame["holiday_proximity"] = seasonality.holiday_proximity(ohlcv.index, holidays)
    frame["options_expiry"] = seasonality.options_expiry(ohlcv.index)

    return frame
