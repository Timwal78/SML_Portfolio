"""Agent 11 — FearGreedContrarian

Thesis:     VIX spike = buy. Euphoria (low VIX + price extension) = sell.
Edge:       Fear/greed extremes revert (Sharpe 3.33 in backtest)
Data:       Yahoo Finance (VIX), Tradier
Signal:     +1 extreme fear (VIX > 2-sigma spike), -1 extreme complacency
"""

from __future__ import annotations

import pandas as pd

from src.agents.base_agent import AgentMetadata, BaseAgent


class FearGreedContrarian(BaseAgent):
    metadata = AgentMetadata(
        agent_id=11,
        name="FearGreedContrarian",
        thesis=(
            "VIX spike = buy. Euphoria (low VIX + price extension) = sell."
        ),
        factors=['vix_momentum', 'vix_zscore_90d', 'price_extension_vs_200dma'],
        edge="Fear/greed extremes revert (Sharpe 3.33 in backtest)",
        data_sources=['Yahoo Finance (VIX)', 'Tradier'],
        long_only=False,
    )

    def generate_signal(self, factor_frame: pd.DataFrame) -> pd.Series:
        """See module docstring for the signal rule. `factor_frame` columns
        must already be `.shift(1)`'d (see factors/lint_check.py).
        """
        # vix_zscore_90d comes from src/factors/sentiment.py::vix_regime(vix_close, n=90).
        extreme_fear = factor_frame["vix_zscore_90d"] > 2.0
        extreme_complacency = (factor_frame["vix_zscore_90d"] < -1.0) & (
            factor_frame["price_extension_vs_200dma"] > 0.10
        )

        signal = pd.Series(0, index=factor_frame.index, dtype=int)
        signal[extreme_fear] = 1
        signal[extreme_complacency] = -1
        return signal
