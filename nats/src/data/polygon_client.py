"""Real-time ticks, Level 2 order book, news sentiment (Polygon.io).

Required env vars: POLYGON_API_KEY
"""

from __future__ import annotations

import pandas as pd

from src.data.base_client import BaseDataClient, UpstreamUnavailableError


class PolygonClient(BaseDataClient):
    required_env_vars = ['POLYGON_API_KEY']

    def get_ticks(self, symbol: str, start: str, end: str) -> pd.DataFrame:
        """Tick-level trade data."""
        raise UpstreamUnavailableError(
            "PolygonClient.get_ticks is a scaffold stub — implement the live HTTP call "
            "during Phase 1 data pipeline work. Must raise UpstreamUnavailableError "
            "on failure, never return fabricated data."
        )

    def get_order_book(self, symbol: str) -> pd.DataFrame:
        """Level 2 order book snapshot."""
        raise UpstreamUnavailableError(
            "PolygonClient.get_order_book is a scaffold stub — implement the live HTTP call "
            "during Phase 1 data pipeline work. Must raise UpstreamUnavailableError "
            "on failure, never return fabricated data."
        )

    def get_news_sentiment(self, symbol: str, start: str, end: str) -> pd.DataFrame:
        """News sentiment score time series."""
        raise UpstreamUnavailableError(
            "PolygonClient.get_news_sentiment is a scaffold stub — implement the live HTTP call "
            "during Phase 1 data pipeline work. Must raise UpstreamUnavailableError "
            "on failure, never return fabricated data."
        )
