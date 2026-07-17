"""Agent 06 — CryptoLeadLag

Thesis:     Crypto sentiment leads equity markets by 12-24 hours.
Edge:       Retail sentiment flows crypto to equity
Data:       Binance, Alpaca
Signal:     +1 if BTC 24h mom > 2% and decoupled from equity, else 0
"""

from __future__ import annotations

import pandas as pd

from src.agents.base_agent import AgentMetadata, BaseAgent


class CryptoLeadLag(BaseAgent):
    metadata = AgentMetadata(
        agent_id=6,
        name="CryptoLeadLag",
        thesis=(
            "Crypto sentiment leads equity markets by 12-24 hours."
        ),
        factors=['btc_momentum', 'crypto_equity_correlation', 'crypto_decoupling_score'],
        edge="Retail sentiment flows crypto to equity",
        data_sources=['Binance', 'Alpaca'],
        long_only=False,
    )

    def generate_signal(self, factor_frame: pd.DataFrame) -> pd.Series:
        """See module docstring for the signal rule. `factor_frame` columns
        must already be `.shift(1)`'d (see factors/lint_check.py).
        """
        raise NotImplementedError(
            "CryptoLeadLag.generate_signal is a scaffold stub — implement per the "
            "signal rule in the module docstring during Phase 1/2."
        )
