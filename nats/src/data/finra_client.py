"""Dark pool / ATS transparency reports, short interest reports (FINRA, public, free).

Required env vars: none (public/unauthenticated)
"""

from __future__ import annotations

import pandas as pd

from src.data.base_client import BaseDataClient, UpstreamUnavailableError


class FinraClient(BaseDataClient):
    required_env_vars = []

    def get_ats_volume(self, symbol: str, week: str) -> pd.DataFrame:
        """Weekly ATS (dark pool) volume by venue."""
        raise UpstreamUnavailableError(
            "FinraClient.get_ats_volume is a scaffold stub — implement the live HTTP call "
            "during Phase 1 data pipeline work. Must raise UpstreamUnavailableError "
            "on failure, never return fabricated data."
        )

    def get_short_interest(self, symbol: str) -> pd.DataFrame:
        """Bimonthly short interest report."""
        raise UpstreamUnavailableError(
            "FinraClient.get_short_interest is a scaffold stub — implement the live HTTP call "
            "during Phase 1 data pipeline work. Must raise UpstreamUnavailableError "
            "on failure, never return fabricated data."
        )
