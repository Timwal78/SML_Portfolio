"""Agent 14 — OptionsFlowReader

Thesis:     Unusual options activity precedes major price moves by 1-3 days.
Edge:       Smart money positions in options before equity moves
Data:       Tradier (full options chain)
Signal:     +1 unusual call activity, -1 unusual put activity, threshold 3-sigma OI
Constraint: Ignore SPX/SPY - too much noise. Focus on individual equities.
"""

from __future__ import annotations

import pandas as pd

from src.agents.base_agent import AgentMetadata, BaseAgent


class OptionsFlowReader(BaseAgent):
    metadata = AgentMetadata(
        agent_id=14,
        name="OptionsFlowReader",
        thesis=(
            "Unusual options activity precedes major price moves by 1-3 days."
        ),
        factors=['unusual_oi_spike_3sigma', 'put_call_ratio_extreme', 'itm_call_buying'],
        edge="Smart money positions in options before equity moves",
        data_sources=['Tradier (full options chain)'],
        long_only=False,
    )

    def generate_signal(self, factor_frame: pd.DataFrame) -> pd.Series:
        """See module docstring for the signal rule. `factor_frame` columns
        must already be `.shift(1)`'d (see factors/lint_check.py).
        """
        raise NotImplementedError(
            "OptionsFlowReader.generate_signal is a scaffold stub — implement per the "
            "signal rule in the module docstring during Phase 1/2."
        )
