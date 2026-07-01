"""Equities, options chain, market data (Tradier sandbox + production).

Required env vars: TRADIER_ACCESS_TOKEN, TRADIER_SANDBOX
"""

from __future__ import annotations

import pandas as pd

from src.data.base_client import BaseDataClient, UpstreamUnavailableError


class TradierClient(BaseDataClient):
    required_env_vars = ['TRADIER_ACCESS_TOKEN', 'TRADIER_SANDBOX']

    def get_quote(self, symbol: str) -> pd.DataFrame:
        """Latest quote for a single symbol."""
        raise UpstreamUnavailableError(
            "TradierClient.get_quote is a scaffold stub — implement the live HTTP call "
            "during Phase 1 data pipeline work. Must raise UpstreamUnavailableError "
            "on failure, never return fabricated data."
        )

    def get_ohlcv(self, symbol: str, start: str, end: str, interval: str = 'daily') -> pd.DataFrame:
        """Historical OHLCV bars."""
        raise UpstreamUnavailableError(
            "TradierClient.get_ohlcv is a scaffold stub — implement the live HTTP call "
            "during Phase 1 data pipeline work. Must raise UpstreamUnavailableError "
            "on failure, never return fabricated data."
        )

    def get_options_chain(self, symbol: str, expiration: str) -> pd.DataFrame:
        """Full options chain for one expiration."""
        raise UpstreamUnavailableError(
            "TradierClient.get_options_chain is a scaffold stub — implement the live HTTP call "
            "during Phase 1 data pipeline work. Must raise UpstreamUnavailableError "
            "on failure, never return fabricated data."
        )
