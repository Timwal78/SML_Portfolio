"""Agent 03 — VolRegimeDetector

Thesis:     Volatility clustering predicts regime transitions.
Edge:       Trade regime change before it shows in price
Data:       Tradier, Yahoo Finance (VIX proxy)
Signal:     +1 low vol expansion, -1 high vol spike, 0 neutral
"""

from __future__ import annotations

import pandas as pd

from src.agents.base_agent import AgentMetadata, BaseAgent


class VolRegimeDetector(BaseAgent):
    metadata = AgentMetadata(
        agent_id=3,
        name="VolRegimeDetector",
        thesis=(
            "Volatility clustering predicts regime transitions."
        ),
        factors=['vol_5d', 'vol_10d', 'vol_20d', 'vol_of_vol', 'vix_momentum', 'parkinson'],
        edge="Trade regime change before it shows in price",
        data_sources=['Tradier', 'Yahoo Finance (VIX proxy)'],
        long_only=False,
    )

    def generate_signal(self, factor_frame: pd.DataFrame) -> pd.Series:
        """See module docstring for the signal rule. `factor_frame` columns
        must already be `.shift(1)`'d (see factors/lint_check.py).
        """
        raise NotImplementedError(
            "VolRegimeDetector.generate_signal is a scaffold stub — implement per the "
            "signal rule in the module docstring during Phase 1/2."
        )
