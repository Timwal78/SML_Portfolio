"""Fundamentals, economic indicators, forex, EPS surprises (Alpha Vantage).

Required env vars: ALPHA_VANTAGE_API_KEY
"""

from __future__ import annotations

import pandas as pd

from src.data.base_client import BaseDataClient, UpstreamUnavailableError


class AlphaVantageClient(BaseDataClient):
    required_env_vars = ['ALPHA_VANTAGE_API_KEY']

    def get_earnings(self, symbol: str) -> pd.DataFrame:
        """EPS actual/estimate/surprise by announced date."""
        raise UpstreamUnavailableError(
            "AlphaVantageClient.get_earnings is a scaffold stub — implement the live HTTP call "
            "during Phase 1 data pipeline work. Must raise UpstreamUnavailableError "
            "on failure, never return fabricated data."
        )

    def get_economic_indicator(self, indicator: str) -> pd.DataFrame:
        """e.g. CPI, NFP, treasury yield, fed funds rate series."""
        raise UpstreamUnavailableError(
            "AlphaVantageClient.get_economic_indicator is a scaffold stub — implement the live HTTP call "
            "during Phase 1 data pipeline work. Must raise UpstreamUnavailableError "
            "on failure, never return fabricated data."
        )

    def get_fx_rate(self, from_currency: str, to_currency: str) -> pd.DataFrame:
        """Historical FX rate series."""
        raise UpstreamUnavailableError(
            "AlphaVantageClient.get_fx_rate is a scaffold stub — implement the live HTTP call "
            "during Phase 1 data pipeline work. Must raise UpstreamUnavailableError "
            "on failure, never return fabricated data."
        )
