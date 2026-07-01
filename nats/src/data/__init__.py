"""Data ingestion clients for all 9 sources. Each client raises
`UpstreamUnavailableError` on failure — never falls back to mock data,
per the sovereign data mandate.
"""

from src.data.base_client import BaseDataClient, UpstreamUnavailableError

from src.data.tradier_client import TradierClient
from src.data.polygon_client import PolygonClient
from src.data.alpaca_client import AlpacaClient
from src.data.alpha_vantage_client import AlphaVantageClient
from src.data.binance_client import BinanceClient
from src.data.yahoo_client import YahooClient
from src.data.sec_edgar_client import SecEdgarClient
from src.data.finra_client import FinraClient

__all__ = [
    "BaseDataClient",
    "UpstreamUnavailableError",
    "TradierClient",
    "PolygonClient",
    "AlpacaClient",
    "AlphaVantageClient",
    "BinanceClient",
    "YahooClient",
    "SecEdgarClient",
    "FinraClient",
]
