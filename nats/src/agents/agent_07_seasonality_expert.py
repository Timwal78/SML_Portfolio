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
        # day_of_week_effect already carries the base +1/0/-1 calendar signal.
        # turn_of_month (historically positive institutional rebalancing flow)
        # can turn a neutral day positive; holiday_proximity (thin, unreliable
        # liquidity) dampens any signal to neutral regardless of the day.
        signal = factor_frame["day_of_week_effect"].copy()
        signal[factor_frame["holiday_proximity"] == 1] = 0
        turn_of_month_boost = (factor_frame["turn_of_month"] == 1) & (signal == 0)
        signal[turn_of_month_boost] = 1
        return signal.astype(int)
