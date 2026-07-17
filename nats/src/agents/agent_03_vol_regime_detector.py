"""Agent 03 — VolRegimeDetector

Thesis:     Volatility clustering predicts regime transitions.
Edge:       Trade regime change before it shows in price
Data:       Tradier, Yahoo Finance (VIX proxy)
Signal:     +1 low vol expansion, -1 high vol spike, 0 neutral
"""

from __future__ import annotations

import pandas as pd

from src.agents.base_agent import AgentMetadata, BaseAgent


class VolRegimeDetector(BaseAgent):
    metadata = AgentMetadata(
        agent_id=3,
        name="VolRegimeDetector",
        thesis=(
            "Volatility clustering predicts regime transitions."
        ),
        factors=['vol_5d', 'vol_10d', 'vol_20d', 'vol_of_vol', 'vix_momentum', 'parkinson'],
        edge="Trade regime change before it shows in price",
        data_sources=['Tradier', 'Yahoo Finance (VIX proxy)'],
        long_only=False,
    )

    def generate_signal(self, factor_frame: pd.DataFrame) -> pd.Series:
        """See module docstring for the signal rule. `factor_frame` columns
        must already be `.shift(1)`'d (see factors/lint_check.py).
        """
        # v1 heuristic (needs Phase 2 recalibration against realized regime
        # labels): VIX momentum is the primary trigger, since a fast VIX move
        # is the clearest early signature of a regime transition; vol_of_vol
        # confirms whether the move is a genuine clustering event vs noise.
        spike_threshold, contraction_threshold = 0.10, -0.10

        high_vol_spike = (factor_frame["vix_momentum"] > spike_threshold) & (
            factor_frame["vol_of_vol"] > factor_frame["vol_of_vol"].rolling(20).median()
        )
        low_vol_expansion = (factor_frame["vix_momentum"] < contraction_threshold) & (
            factor_frame["vol_of_vol"] <= factor_frame["vol_of_vol"].rolling(20).median()
        )

        signal = pd.Series(0, index=factor_frame.index, dtype=int)
        signal[low_vol_expansion] = 1
        signal[high_vol_spike] = -1
        return signal
