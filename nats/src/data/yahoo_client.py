"""Historical + daily OHLCV data (Yahoo Finance via `yfinance`, unauthenticated).

This is the primary data source for the initial paper-trading launch: it
requires no API key, so it's usable immediately, unlike Tradier/Polygon/
Alpha Vantage/Binance which are still interface stubs pending credentials
(see `.env.example`). Cross-validate against a paid source once one is
wired — Yahoo's free-tier data has known gaps/delays and should not be the
sole source for anything beyond paper trading.

Required env vars: none (public/unauthenticated)
"""

from __future__ import annotations

import pandas as pd
import yfinance as yf

from src.data.base_client import BaseDataClient, UpstreamUnavailableError


class YahooClient(BaseDataClient):
    required_env_vars: tuple[str, ...] = ()

    def get_ohlcv(self, symbol: str, start: str, end: str | None = None, interval: str = "1d") -> pd.DataFrame:
        """Historical OHLCV bars. Columns: open, high, low, close, volume.
        Raises UpstreamUnavailableError if Yahoo returns no data (bad symbol,
        network failure, or rate limiting) — never returns an empty/fabricated frame.
        """
        try:
            raw = yf.download(
                symbol, start=start, end=end, interval=interval,
                progress=False, auto_adjust=False, multi_level_index=False,
            )
        except Exception as exc:  # yfinance raises a variety of exception types
            raise UpstreamUnavailableError(f"YahooClient.get_ohlcv({symbol}) failed: {exc}") from exc

        if raw is None or raw.empty:
            raise UpstreamUnavailableError(
                f"YahooClient.get_ohlcv({symbol}) returned no data for {start}..{end}"
            )

        raw = raw.rename(columns=str.lower)
        return raw[["open", "high", "low", "close", "volume"]]

    def get_latest_close(self, symbol: str) -> float:
        """Most recent daily close — used for order sizing at signal time."""
        ohlcv = self.get_ohlcv(symbol, start=(pd.Timestamp.today().normalize() - pd.Timedelta(days=10)).strftime("%Y-%m-%d"))
        return float(ohlcv["close"].iloc[-1])
