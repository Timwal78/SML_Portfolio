"""Equities, options chain, market data (Tradier sandbox + production).

Real HTTP calls against Tradier's documented REST API via `requests`
(the `tradier-api` PyPI wrapper in the original requirements pin does not
install cleanly in this environment, so this client talks to the REST API
directly instead of depending on it).

Required env vars: TRADIER_ACCESS_TOKEN, TRADIER_SANDBOX
"""

from __future__ import annotations

import pandas as pd
import requests

from src.data.base_client import BaseDataClient, UpstreamUnavailableError

_PRODUCTION_BASE_URL = "https://api.tradier.com/v1"
_SANDBOX_BASE_URL = "https://sandbox.tradier.com/v1"


class TradierClient(BaseDataClient):
    required_env_vars = ["TRADIER_ACCESS_TOKEN", "TRADIER_SANDBOX"]

    def __init__(self, **credentials: str):
        super().__init__(**credentials)
        sandbox = str(credentials["TRADIER_SANDBOX"]).strip().lower() == "true"
        self._base_url = _SANDBOX_BASE_URL if sandbox else _PRODUCTION_BASE_URL
        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": f"Bearer {credentials['TRADIER_ACCESS_TOKEN']}",
            "Accept": "application/json",
        })

    def _get(self, path: str, params: dict) -> dict:
        try:
            response = self._session.get(f"{self._base_url}{path}", params=params, timeout=15)
            response.raise_for_status()
        except requests.RequestException as exc:
            raise UpstreamUnavailableError(f"Tradier {path} request failed: {exc}") from exc
        return response.json()

    def get_quote(self, symbol: str) -> pd.DataFrame:
        """Latest quote for a single symbol."""
        payload = self._get("/markets/quotes", {"symbols": symbol, "greeks": "false"})
        quote = payload.get("quotes", {}).get("quote")
        if not quote:
            raise UpstreamUnavailableError(f"TradierClient.get_quote({symbol}) returned no quote")
        if isinstance(quote, list):
            quote = quote[0]
        return pd.DataFrame([quote])

    def get_ohlcv(self, symbol: str, start: str, end: str | None = None, interval: str = "daily") -> pd.DataFrame:
        """Historical OHLCV bars. Columns: open, high, low, close, volume,
        indexed by date. `interval` is one of daily/weekly/monthly per the
        Tradier /markets/history endpoint.
        """
        params = {"symbol": symbol, "interval": interval, "start": start}
        if end:
            params["end"] = end
        payload = self._get("/markets/history", params)
        history = payload.get("history")
        if not history or not history.get("day"):
            raise UpstreamUnavailableError(
                f"TradierClient.get_ohlcv({symbol}) returned no data for {start}..{end}"
            )
        days = history["day"]
        if isinstance(days, dict):  # Tradier returns a bare dict for single-day ranges
            days = [days]

        df = pd.DataFrame(days)
        df["date"] = pd.to_datetime(df["date"])
        df = df.set_index("date").sort_index()
        return df[["open", "high", "low", "close", "volume"]].astype(float)

    def get_latest_close(self, symbol: str) -> float:
        quote = self.get_quote(symbol)
        return float(quote["last"].iloc[0])

    def get_options_chain(self, symbol: str, expiration: str) -> pd.DataFrame:
        """Full options chain for one expiration."""
        payload = self._get(
            "/markets/options/chains", {"symbol": symbol, "expiration": expiration, "greeks": "true"}
        )
        options = payload.get("options", {}).get("option")
        if not options:
            raise UpstreamUnavailableError(
                f"TradierClient.get_options_chain({symbol}, {expiration}) returned no data"
            )
        if isinstance(options, dict):
            options = [options]
        return pd.DataFrame(options)
