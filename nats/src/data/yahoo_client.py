"""Historical validation, backup data (Yahoo Finance, unauthenticated).

Required env vars: none (public/unauthenticated)
"""

from __future__ import annotations

import pandas as pd

from src.data.base_client import BaseDataClient, UpstreamUnavailableError


class YahooClient(BaseDataClient):
    required_env_vars = []

    def get_ohlcv(self, symbol: str, start: str, end: str) -> pd.DataFrame:
        """Historical OHLCV bars, used for cross-validation against paid sources."""
        raise UpstreamUnavailableError(
            "YahooClient.get_ohlcv is a scaffold stub — implement the live HTTP call "
            "during Phase 1 data pipeline work. Must raise UpstreamUnavailableError "
            "on failure, never return fabricated data."
        )
