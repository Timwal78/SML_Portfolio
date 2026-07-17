"""Paper trading, fractional shares, crypto (Alpaca).

Required env vars: ALPACA_API_KEY, ALPACA_SECRET_KEY, ALPACA_PAPER
"""

from __future__ import annotations

import pandas as pd

from src.data.base_client import BaseDataClient, UpstreamUnavailableError


class AlpacaClient(BaseDataClient):
    required_env_vars = ['ALPACA_API_KEY', 'ALPACA_SECRET_KEY', 'ALPACA_PAPER']

    def get_ohlcv(self, symbol: str, start: str, end: str, timeframe: str = '1Day') -> pd.DataFrame:
        """Historical OHLCV bars (IEX real-time on free tier)."""
        raise UpstreamUnavailableError(
            "AlpacaClient.get_ohlcv is a scaffold stub — implement the live HTTP call "
            "during Phase 1 data pipeline work. Must raise UpstreamUnavailableError "
            "on failure, never return fabricated data."
        )

    def submit_order(self, symbol: str, qty: float, side: str, order_type: str = 'market') -> dict:
        """Submit a paper (or live) order."""
        raise UpstreamUnavailableError(
            "AlpacaClient.submit_order is a scaffold stub — implement the live HTTP call "
            "during Phase 1 data pipeline work. Must raise UpstreamUnavailableError "
            "on failure, never return fabricated data."
        )

    def get_account(self, ) -> dict:
        """Account equity, buying power, P&L."""
        raise UpstreamUnavailableError(
            "AlpacaClient.get_account is a scaffold stub — implement the live HTTP call "
            "during Phase 1 data pipeline work. Must raise UpstreamUnavailableError "
            "on failure, never return fabricated data."
        )
