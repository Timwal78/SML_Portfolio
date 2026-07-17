"""Agent 19 — CreditSpreadReader

Thesis:     HYG/LQD credit spread leads equity by 1-3 days in risk-off moves.
Edge:       Credit market is smarter than equity on credit-sensitive moves
Data:       Tradier (HYG, LQD, SPY)
Signal:     +1 credit spreads tightening with equity lagging, -1 spreads widening
Constraint: Only signal when credit and equity diverge > 1.5-sigma for 2+ days.
"""

from __future__ import annotations

import pandas as pd

from src.agents.base_agent import AgentMetadata, BaseAgent


class CreditSpreadReader(BaseAgent):
    metadata = AgentMetadata(
        agent_id=19,
        name="CreditSpreadReader",
        thesis=(
            "HYG/LQD credit spread leads equity by 1-3 days in risk-off moves."
        ),
        factors=['hyg_lqd_spread_zscore', 'credit_equity_divergence', 'junk_bond_momentum'],
        edge="Credit market is smarter than equity on credit-sensitive moves",
        data_sources=['Tradier (HYG, LQD, SPY)'],
        long_only=False,
    )

    def generate_signal(self, factor_frame: pd.DataFrame) -> pd.Series:
        """See module docstring for the signal rule. `factor_frame` columns
        must already be `.shift(1)`'d (see factors/lint_check.py).
        """
        raise NotImplementedError(
            "CreditSpreadReader.generate_signal is a scaffold stub — implement per the "
            "signal rule in the module docstring during Phase 1/2."
        )
