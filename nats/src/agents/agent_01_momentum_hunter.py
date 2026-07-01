"""Agent 01 — MomentumHunter

Thesis:     Multi-horizon trend persistence. Buys when mom_5d + mom_10d + mom_20d align.
Edge:       Trend continuation in liquid large-caps
Data:       Tradier, Polygon
Signal:     +1 if 3+ horizons positive and accelerating, -1 if 3+ negative, else 0
"""

from __future__ import annotations

import pandas as pd

from src.agents.base_agent import AgentMetadata, BaseAgent


class MomentumHunter(BaseAgent):
    metadata = AgentMetadata(
        agent_id=1,
        name="MomentumHunter",
        thesis=(
            "Multi-horizon trend persistence. Buys when mom_5d + mom_10d + mom_20d align."
        ),
        factors=['mom_3d', 'mom_5d', 'mom_10d', 'mom_15d', 'mom_20d', 'acceleration'],
        edge="Trend continuation in liquid large-caps",
        data_sources=['Tradier', 'Polygon'],
        long_only=False,
    )

    def generate_signal(self, factor_frame: pd.DataFrame) -> pd.Series:
        """See module docstring for the signal rule. `factor_frame` columns
        must already be `.shift(1)`'d (see factors/lint_check.py).
        """
        raise NotImplementedError(
            "MomentumHunter.generate_signal is a scaffold stub — implement per the "
            "signal rule in the module docstring during Phase 1/2."
        )
