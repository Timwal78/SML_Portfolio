"""Agent 18 — SentimentVelocity

Thesis:     Rate of change in news sentiment predicts price before it moves.
Edge:       Level is priced in. Velocity is not. Accelerating negative = short signal.
Data:       Polygon (news sentiment API)
Signal:     +1 sentiment accelerating positive, -1 accelerating negative
Constraint: Distinction from Agent 11: uses news velocity, not VIX. Different data, different signal.
"""

from __future__ import annotations

import pandas as pd

from src.agents.base_agent import AgentMetadata, BaseAgent


class SentimentVelocity(BaseAgent):
    metadata = AgentMetadata(
        agent_id=18,
        name="SentimentVelocity",
        thesis=(
            "Rate of change in news sentiment predicts price before it moves."
        ),
        factors=['news_sentiment_velocity', 'sentiment_acceleration'],
        edge="Level is priced in. Velocity is not. Accelerating negative = short signal.",
        data_sources=['Polygon (news sentiment API)'],
        long_only=False,
    )

    def generate_signal(self, factor_frame: pd.DataFrame) -> pd.Series:
        """See module docstring for the signal rule. `factor_frame` columns
        must already be `.shift(1)`'d (see factors/lint_check.py).
        """
        raise NotImplementedError(
            "SentimentVelocity.generate_signal is a scaffold stub — implement per the "
            "signal rule in the module docstring during Phase 1/2."
        )
