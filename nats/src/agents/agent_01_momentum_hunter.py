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
        horizons = ["mom_3d", "mom_5d", "mom_10d", "mom_15d", "mom_20d"]
        positive_count = (factor_frame[horizons] > 0).sum(axis=1)
        negative_count = (factor_frame[horizons] < 0).sum(axis=1)
        accelerating_up = factor_frame["acceleration"] > 0
        accelerating_down = factor_frame["acceleration"] < 0

        signal = pd.Series(0, index=factor_frame.index, dtype=int)
        signal[(positive_count >= 3) & accelerating_up] = 1
        signal[(negative_count >= 3) & accelerating_down] = -1
        return signal
