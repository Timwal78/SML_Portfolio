"""Agent 02 — MeanReversionSniper

Thesis:     Extreme RSI + volume confirmation = bounce trade.
Edge:       Oversold/overbought extremes with volume exhaustion
Data:       Tradier, Polygon
Signal:     +1 if RSI < 30 + volume spike, -1 if RSI > 70 + volume spike, else 0
"""

from __future__ import annotations

import pandas as pd

from src.agents.base_agent import AgentMetadata, BaseAgent


class MeanReversionSniper(BaseAgent):
    metadata = AgentMetadata(
        agent_id=2,
        name="MeanReversionSniper",
        thesis=(
            "Extreme RSI + volume confirmation = bounce trade."
        ),
        factors=['rsi_14', 'williams_r', 'bollinger_position', 'z_score', 'volume_confirmation'],
        edge="Oversold/overbought extremes with volume exhaustion",
        data_sources=['Tradier', 'Polygon'],
        long_only=False,
    )

    def generate_signal(self, factor_frame: pd.DataFrame) -> pd.Series:
        """See module docstring for the signal rule. `factor_frame` columns
        must already be `.shift(1)`'d (see factors/lint_check.py).
        """
        raise NotImplementedError(
            "MeanReversionSniper.generate_signal is a scaffold stub — implement per the "
            "signal rule in the module docstring during Phase 1/2."
        )
