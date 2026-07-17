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
        volume_spike = factor_frame["volume_confirmation"] > 0
        oversold = (factor_frame["rsi_14"] < 30) & volume_spike
        overbought = (factor_frame["rsi_14"] > 70) & volume_spike

        signal = pd.Series(0, index=factor_frame.index, dtype=int)
        signal[oversold] = 1
        signal[overbought] = -1
        return signal
