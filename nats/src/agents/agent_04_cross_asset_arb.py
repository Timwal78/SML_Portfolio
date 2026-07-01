"""Agent 04 — CrossAssetArb

Thesis:     Equity-bond correlation breaks predict regime shifts.
Edge:       Cross-asset dislocation mean reverts within 5-10 days
Data:       Alpaca (SPY, TLT, GLD), Alpha Vantage
Signal:     +1 if correlation breaks down in risk-on direction, -1 risk-off
"""

from __future__ import annotations

import pandas as pd

from src.agents.base_agent import AgentMetadata, BaseAgent


class CrossAssetArb(BaseAgent):
    metadata = AgentMetadata(
        agent_id=4,
        name="CrossAssetArb",
        thesis=(
            "Equity-bond correlation breaks predict regime shifts."
        ),
        factors=['eq_bond_correlation_20d', 'risk_on_score', 'flight_to_quality'],
        edge="Cross-asset dislocation mean reverts within 5-10 days",
        data_sources=['Alpaca (SPY, TLT, GLD)', 'Alpha Vantage'],
        long_only=False,
    )

    def generate_signal(self, factor_frame: pd.DataFrame) -> pd.Series:
        """See module docstring for the signal rule. `factor_frame` columns
        must already be `.shift(1)`'d (see factors/lint_check.py).
        """
        raise NotImplementedError(
            "CrossAssetArb.generate_signal is a scaffold stub — implement per the "
            "signal rule in the module docstring during Phase 1/2."
        )
