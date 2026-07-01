"""Agent 07 — SeasonalityExpert

Thesis:     Calendar effects are persistent and statistically validated.
Edge:       Institutional rebalancing creates predictable flow
Data:       Any OHLCV source
Signal:     +1 on historically positive calendar windows, -1 on negative
"""

from __future__ import annotations

import pandas as pd

from src.agents.base_agent import AgentMetadata, BaseAgent


class SeasonalityExpert(BaseAgent):
    metadata = AgentMetadata(
        agent_id=7,
        name="SeasonalityExpert",
        thesis=(
            "Calendar effects are persistent and statistically validated."
        ),
        factors=['day_of_week_effect', 'turn_of_month', 'holiday_proximity', 'options_expiry'],
        edge="Institutional rebalancing creates predictable flow",
        data_sources=['Any OHLCV source'],
        long_only=False,
    )

    def generate_signal(self, factor_frame: pd.DataFrame) -> pd.Series:
        """See module docstring for the signal rule. `factor_frame` columns
        must already be `.shift(1)`'d (see factors/lint_check.py).
        """
        raise NotImplementedError(
            "SeasonalityExpert.generate_signal is a scaffold stub — implement per the "
            "signal rule in the module docstring during Phase 1/2."
        )
