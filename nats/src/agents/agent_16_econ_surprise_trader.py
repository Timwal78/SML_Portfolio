"""Agent 16 — EconSurpriseTrader

Thesis:     Economic data surprises create multi-day directional moves.
Edge:       First mover on macro data - most retail reacts late
Data:       Alpha Vantage (economic indicators), Yahoo Finance (rate proxies)
Signal:     +1 positive macro surprise (risk-on), -1 negative, 0 in-line
Constraint: Only trade within 2 bars of release. Stale signal = 0.
"""

from __future__ import annotations

import pandas as pd

from src.agents.base_agent import AgentMetadata, BaseAgent


class EconSurpriseTrader(BaseAgent):
    metadata = AgentMetadata(
        agent_id=16,
        name="EconSurpriseTrader",
        thesis=(
            "Economic data surprises create multi-day directional moves."
        ),
        factors=['cpi_surprise', 'nfp_surprise', 'pmi_surprise', 'yield_curve_reaction'],
        edge="First mover on macro data - most retail reacts late",
        data_sources=['Alpha Vantage (economic indicators)', 'Yahoo Finance (rate proxies)'],
        long_only=False,
    )

    def generate_signal(self, factor_frame: pd.DataFrame) -> pd.Series:
        """See module docstring for the signal rule. `factor_frame` columns
        must already be `.shift(1)`'d (see factors/lint_check.py).
        """
        raise NotImplementedError(
            "EconSurpriseTrader.generate_signal is a scaffold stub — implement per the "
            "signal rule in the module docstring during Phase 1/2."
        )
