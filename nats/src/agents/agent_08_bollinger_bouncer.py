"""Agent 08 — BollingerBouncer

Thesis:     Price at Bollinger Band extremes with mean-reversion confirmation.
Edge:       Band squeeze releases are directional
Data:       Tradier
Signal:     Contrarian at 2-sigma band extremes with volume confirmation
"""

from __future__ import annotations

import pandas as pd

from src.agents.base_agent import AgentMetadata, BaseAgent


class BollingerBouncer(BaseAgent):
    metadata = AgentMetadata(
        agent_id=8,
        name="BollingerBouncer",
        thesis=(
            "Price at Bollinger Band extremes with mean-reversion confirmation."
        ),
        factors=['bollinger_position', 'bollinger_width', 'rsi_14', 'volume_confirmation'],
        edge="Band squeeze releases are directional",
        data_sources=['Tradier'],
        long_only=False,
    )

    def generate_signal(self, factor_frame: pd.DataFrame) -> pd.Series:
        """See module docstring for the signal rule. `factor_frame` columns
        must already be `.shift(1)`'d (see factors/lint_check.py).
        """
        volume_spike = factor_frame["volume_confirmation"] > 0
        lower_extreme = (
            (factor_frame["bollinger_position"] <= 0.05)
            & (factor_frame["rsi_14"] < 35)
            & volume_spike
        )
        upper_extreme = (
            (factor_frame["bollinger_position"] >= 0.95)
            & (factor_frame["rsi_14"] > 65)
            & volume_spike
        )

        signal = pd.Series(0, index=factor_frame.index, dtype=int)
        signal[lower_extreme] = 1
        signal[upper_extreme] = -1
        return signal
