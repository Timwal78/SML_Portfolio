"""Agent 15 — StatArb

Thesis:     Cointegrated pairs mean-revert. Trade the spread, not direction.
Edge:       Pure statistical edge, market-neutral, low correlation to ensemble
Data:       Tradier (all pairs: XLE/XOM, GLD/GDX, SPY/IVV, QQQ/XLK, TLT/IEF)
Signal:     +1 spread below -2-sigma (long spread), -1 above +2-sigma (short spread)
Constraint: Validate cointegration monthly with Engle-Granger test. Drop pair if p > 0.05.
"""

from __future__ import annotations

import pandas as pd

from src.agents.base_agent import AgentMetadata, BaseAgent


class StatArb(BaseAgent):
    metadata = AgentMetadata(
        agent_id=15,
        name="StatArb",
        thesis=(
            "Cointegrated pairs mean-revert. Trade the spread, not direction."
        ),
        factors=['spread_zscore', 'half_life_mean_reversion', 'cointegration_pvalue'],
        edge="Pure statistical edge, market-neutral, low correlation to ensemble",
        data_sources=['Tradier (all pairs: XLE/XOM, GLD/GDX, SPY/IVV, QQQ/XLK, TLT/IEF)'],
        long_only=False,
    )

    def generate_signal(self, factor_frame: pd.DataFrame) -> pd.Series:
        """See module docstring for the signal rule. `factor_frame` columns
        must already be `.shift(1)`'d (see factors/lint_check.py).
        """
        raise NotImplementedError(
            "StatArb.generate_signal is a scaffold stub — implement per the "
            "signal rule in the module docstring during Phase 1/2."
        )
