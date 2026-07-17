"""Agent 09 — VolumeConfirmer

Thesis:     Volume spikes confirm or reject price moves.
Edge:       Volume-price divergence predicts reversals
Data:       Polygon (tick-level), Tradier
Signal:     +1 price rise + volume confirm, -1 price rise + volume diverge
"""

from __future__ import annotations

import pandas as pd

from src.agents.base_agent import AgentMetadata, BaseAgent


class VolumeConfirmer(BaseAgent):
    metadata = AgentMetadata(
        agent_id=9,
        name="VolumeConfirmer",
        thesis=(
            "Volume spikes confirm or reject price moves."
        ),
        factors=['obv', 'volume_momentum', 'vwap_deviation', 'amihud_illiquidity'],
        edge="Volume-price divergence predicts reversals",
        data_sources=['Polygon (tick-level)', 'Tradier'],
        long_only=False,
    )

    def generate_signal(self, factor_frame: pd.DataFrame) -> pd.Series:
        """See module docstring for the signal rule. `factor_frame` columns
        must already be `.shift(1)`'d (see factors/lint_check.py).
        """
        price_rising = factor_frame["vwap_deviation"] > 0  # close trading above VWAP
        obv_rising = factor_frame["obv"].diff() > 0
        volume_rising = factor_frame["volume_momentum"] > 0

        confirm = price_rising & volume_rising & obv_rising
        diverge = price_rising & volume_rising & ~obv_rising

        signal = pd.Series(0, index=factor_frame.index, dtype=int)
        signal[confirm] = 1
        signal[diverge] = -1
        return signal
