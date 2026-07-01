"""Agent 20 — ShadowFlowHunter

Thesis:     Market structure manipulation creates detectable anomalies that precede violent mean-reversion (short squeezes, forced unwinds). Monitors FTD spikes, ETF basket proxy shorting, dark pool suppression, synthetic short creation via options, and short interest vs price divergence.
Edge:       Structural manipulation anomalies mean-revert violently once detected
Data:       SEC EDGAR (FTD), FINRA ATS, FINRA short interest, Tradier (options chain)
Signal:     Require 3+ of the 5 weighted indicators triggering simultaneously. 1-2 indicators = noise (signal=0). 3+ = structural anomaly (signal=+1, contrarian long). Signal is NEVER -1 - manipulation is a long-only signal. See shadow_flow/shadow_flow_hunter.py for the full weighted model (this class only implements the BaseAgent contract; the real detection logic lives in shadow_flow/).
Constraint: LONG-ONLY and contrarian by design. Position size capped at 1% (half normal max). Not included in ensemble vote - runs as overlay signal only. Exit: any 2 indicators normalize OR +15% gain OR stop at -5%.
"""

from __future__ import annotations

import pandas as pd

from src.agents.base_agent import AgentMetadata, BaseAgent


class ShadowFlowHunter(BaseAgent):
    metadata = AgentMetadata(
        agent_id=20,
        name="ShadowFlowHunter",
        thesis=(
            "Market structure manipulation creates detectable anomalies that precede violent mean-reversion (short squeezes, forced unwinds). Monitors FTD spikes, ETF basket proxy shorting, dark pool suppression, synthetic short creation via options, and short interest vs price divergence."
        ),
        factors=['ftd_zscore', 'etf_basket_divergence', 'dark_pool_pct', 'synthetic_short_score', 'short_interest_divergence'],
        edge="Structural manipulation anomalies mean-revert violently once detected",
        data_sources=['SEC EDGAR (FTD)', 'FINRA ATS', 'FINRA short interest', 'Tradier (options chain)'],
        long_only=True,
    )

    def generate_signal(self, factor_frame: pd.DataFrame) -> pd.Series:
        """See module docstring for the signal rule. `factor_frame` columns
        must already be `.shift(1)`'d (see factors/lint_check.py).
        """
        raise NotImplementedError(
            "ShadowFlowHunter.generate_signal is a scaffold stub — implement per the "
            "signal rule in the module docstring during Phase 1/2."
        )
