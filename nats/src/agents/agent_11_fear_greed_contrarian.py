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
        raise NotImplementedError(
            "FearGreedContrarian.generate_signal is a scaffold stub — implement per the "
            "signal rule in the module docstring during Phase 1/2."
        )
