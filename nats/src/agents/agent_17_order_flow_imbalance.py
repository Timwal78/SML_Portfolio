"""Agent 17 — OrderFlowImbalance

Thesis:     Level 2 bid/ask imbalance reveals institutional accumulation/distribution.
Edge:       Institutional flow readable from L2 before price moves
Data:       Polygon (Level 2 order book)
Signal:     +1 bid-side imbalance >2-sigma sustained 15min, -1 ask-side, else 0
Constraint: Intraday only. Signal expires at close. Not held overnight.
"""

from __future__ import annotations

import pandas as pd

from src.agents.base_agent import AgentMetadata, BaseAgent


class OrderFlowImbalance(BaseAgent):
    metadata = AgentMetadata(
        agent_id=17,
        name="OrderFlowImbalance",
        thesis=(
            "Level 2 bid/ask imbalance reveals institutional accumulation/distribution."
        ),
        factors=['bid_ask_imbalance_ratio_2sigma', 'depth_of_book_skew', 'tape_speed'],
        edge="Institutional flow readable from L2 before price moves",
        data_sources=['Polygon (Level 2 order book)'],
        long_only=False,
    )

    def generate_signal(self, factor_frame: pd.DataFrame) -> pd.Series:
        """See module docstring for the signal rule. `factor_frame` columns
        must already be `.shift(1)`'d (see factors/lint_check.py).
        """
        raise NotImplementedError(
            "OrderFlowImbalance.generate_signal is a scaffold stub — implement per the "
            "signal rule in the module docstring during Phase 1/2."
        )
