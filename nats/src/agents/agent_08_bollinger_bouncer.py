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
        raise NotImplementedError(
            "BollingerBouncer.generate_signal is a scaffold stub — implement per the "
            "signal rule in the module docstring during Phase 1/2."
        )
