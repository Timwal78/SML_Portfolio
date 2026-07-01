"""Agent 13 — EarningsEdge

Thesis:     Post-earnings drift is persistent and exploitable.
Edge:       Beat estimates -> buy next open. Miss -> short. Drift lasts 5-20 days.
Data:       Alpha Vantage (EPS data, announced date only - no lookahead)
Signal:     +1 positive surprise > 5%, -1 negative surprise > 5%, else 0
Constraint: Must use ANNOUNCED date, not report date. Shift by 1 bar minimum.
"""

from __future__ import annotations

import pandas as pd

from src.agents.base_agent import AgentMetadata, BaseAgent


class EarningsEdge(BaseAgent):
    metadata = AgentMetadata(
        agent_id=13,
        name="EarningsEdge",
        thesis=(
            "Post-earnings drift is persistent and exploitable."
        ),
        factors=['eps_surprise_magnitude', 'eps_surprise_direction', 'analyst_revision_velocity'],
        edge="Beat estimates -> buy next open. Miss -> short. Drift lasts 5-20 days.",
        data_sources=['Alpha Vantage (EPS data, announced date only - no lookahead)'],
        long_only=False,
    )

    def generate_signal(self, factor_frame: pd.DataFrame) -> pd.Series:
        """See module docstring for the signal rule. `factor_frame` columns
        must already be `.shift(1)`'d (see factors/lint_check.py).
        """
        raise NotImplementedError(
            "EarningsEdge.generate_signal is a scaffold stub — implement per the "
            "signal rule in the module docstring during Phase 1/2."
        )
