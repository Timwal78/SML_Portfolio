"""Agent 12 — MacroRotator

Thesis:     Regime-based rotation between risk assets and defensives.
Edge:       Macro regime shifts create multi-week trends
Data:       Alpha Vantage (economic indicators)
Signal:     +1 risk-on macro regime, -1 risk-off, 0 transitioning
"""

from __future__ import annotations

import pandas as pd

from src.agents.base_agent import AgentMetadata, BaseAgent


class MacroRotator(BaseAgent):
    metadata = AgentMetadata(
        agent_id=12,
        name="MacroRotator",
        thesis=(
            "Regime-based rotation between risk assets and defensives."
        ),
        factors=['yield_curve_slope', 'fed_funds_futures', 'inflation_breakevens', 'regime_state'],
        edge="Macro regime shifts create multi-week trends",
        data_sources=['Alpha Vantage (economic indicators)'],
        long_only=False,
    )

    def generate_signal(self, factor_frame: pd.DataFrame) -> pd.Series:
        """See module docstring for the signal rule. `factor_frame` columns
        must already be `.shift(1)`'d (see factors/lint_check.py).
        """
        raise NotImplementedError(
            "MacroRotator.generate_signal is a scaffold stub — implement per the "
            "signal rule in the module docstring during Phase 1/2."
        )
