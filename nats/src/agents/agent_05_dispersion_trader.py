"""Agent 05 — DispersionTrader

Thesis:     QQQ/SPY divergence fades back to correlation mean.
Edge:       Sector rotation extremes mean-revert
Data:       Tradier (QQQ, SPY)
Signal:     Contrarian to divergence direction when z-score > 2
"""

from __future__ import annotations

import pandas as pd

from src.agents.base_agent import AgentMetadata, BaseAgent


class DispersionTrader(BaseAgent):
    metadata = AgentMetadata(
        agent_id=5,
        name="DispersionTrader",
        thesis=(
            "QQQ/SPY divergence fades back to correlation mean."
        ),
        factors=['qqq_spy_spread_zscore', 'momentum_divergence', 'rolling_correlation'],
        edge="Sector rotation extremes mean-revert",
        data_sources=['Tradier (QQQ, SPY)'],
        long_only=False,
    )

    def generate_signal(self, factor_frame: pd.DataFrame) -> pd.Series:
        """See module docstring for the signal rule. `factor_frame` columns
        must already be `.shift(1)`'d (see factors/lint_check.py).
        """
        raise NotImplementedError(
            "DispersionTrader.generate_signal is a scaffold stub — implement per the "
            "signal rule in the module docstring during Phase 1/2."
        )
