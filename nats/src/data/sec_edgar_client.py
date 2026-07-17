"""FTD data, insider trades, 8-K filings (SEC EDGAR, public, free, ~2-week FTD reporting lag).

Required env vars: none (public/unauthenticated)
"""

from __future__ import annotations

import pandas as pd

from src.data.base_client import BaseDataClient, UpstreamUnavailableError


class SecEdgarClient(BaseDataClient):
    required_env_vars = []

    def get_ftd_report(self, symbol: str, settlement_date: str) -> pd.DataFrame:
        """Fails-to-deliver shares for one settlement period."""
        raise UpstreamUnavailableError(
            "SecEdgarClient.get_ftd_report is a scaffold stub — implement the live HTTP call "
            "during Phase 1 data pipeline work. Must raise UpstreamUnavailableError "
            "on failure, never return fabricated data."
        )

    def get_insider_trades(self, symbol: str) -> pd.DataFrame:
        """Form 4 insider transactions."""
        raise UpstreamUnavailableError(
            "SecEdgarClient.get_insider_trades is a scaffold stub — implement the live HTTP call "
            "during Phase 1 data pipeline work. Must raise UpstreamUnavailableError "
            "on failure, never return fabricated data."
        )
