"""Crypto spot/futures, on-chain metrics (Binance).

Required env vars: BINANCE_API_KEY, BINANCE_SECRET_KEY
"""

from __future__ import annotations

import pandas as pd

from src.data.base_client import BaseDataClient, UpstreamUnavailableError


class BinanceClient(BaseDataClient):
    required_env_vars = ['BINANCE_API_KEY', 'BINANCE_SECRET_KEY']

    def get_ohlcv(self, symbol: str, interval: str, start: str, end: str) -> pd.DataFrame:
        """Historical OHLCV bars."""
        raise UpstreamUnavailableError(
            "BinanceClient.get_ohlcv is a scaffold stub — implement the live HTTP call "
            "during Phase 1 data pipeline work. Must raise UpstreamUnavailableError "
            "on failure, never return fabricated data."
        )

    def get_ticker_24h(self, symbol: str) -> dict:
        """24h rolling ticker stats."""
        raise UpstreamUnavailableError(
            "BinanceClient.get_ticker_24h is a scaffold stub — implement the live HTTP call "
            "during Phase 1 data pipeline work. Must raise UpstreamUnavailableError "
            "on failure, never return fabricated data."
        )
