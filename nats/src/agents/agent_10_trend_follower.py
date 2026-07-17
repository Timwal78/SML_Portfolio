"""Agent 10 — TrendFollower

Thesis:     Dynamic position sizing based on trend strength, cut losers fast.
Edge:       Asymmetric payoff: let winners run, cut fast
Data:       Tradier
Signal:     +1 strong trend up, -1 strong trend down, sized by ATR
"""

from __future__ import annotations

import pandas as pd

from src.agents.base_agent import AgentMetadata, BaseAgent


class TrendFollower(BaseAgent):
    metadata = AgentMetadata(
        agent_id=10,
        name="TrendFollower",
        thesis=(
            "Dynamic position sizing based on trend strength, cut losers fast."
        ),
        factors=['mom_5d', 'mom_20d', 'atr_stop', 'kelly_fraction'],
        edge="Asymmetric payoff: let winners run, cut fast",
        data_sources=['Tradier'],
        long_only=False,
    )

    def generate_signal(self, factor_frame: pd.DataFrame) -> pd.Series:
        """See module docstring for the signal rule. `factor_frame` columns
        must already be `.shift(1)`'d (see factors/lint_check.py).
        """
        # atr_stop/kelly_fraction inform position sizing (src/risk/risk_engine.py),
        # not the directional signal itself — the signal is trend alignment
        # across the short and long momentum horizons.
        strong_up = (factor_frame["mom_5d"] > 0) & (factor_frame["mom_20d"] > 0)
        strong_down = (factor_frame["mom_5d"] < 0) & (factor_frame["mom_20d"] < 0)

        signal = pd.Series(0, index=factor_frame.index, dtype=int)
        signal[strong_up] = 1
        signal[strong_down] = -1
        return signal
