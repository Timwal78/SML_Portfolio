"""Alpaca execution adapter — paper trading, fractional shares, crypto.

Required env vars: ALPACA_API_KEY, ALPACA_SECRET_KEY, ALPACA_PAPER
"""

from __future__ import annotations

from src.data.base_client import UpstreamUnavailableError
from src.execution.base_adapter import BaseExecutionAdapter, OrderRequest, OrderResult


class AlpacaExecutionAdapter(BaseExecutionAdapter):
    def __init__(self, api_key: str, secret_key: str, paper: bool = True):
        if not api_key or not secret_key:
            raise UpstreamUnavailableError(
                "AlpacaExecutionAdapter requires ALPACA_API_KEY and ALPACA_SECRET_KEY"
            )
        self._api_key = api_key
        self._secret_key = secret_key
        self._paper = paper

    def submit_order(self, request: OrderRequest) -> OrderResult:
        raise NotImplementedError(
            "AlpacaExecutionAdapter.submit_order is a scaffold stub — implement "
            "the live Alpaca order-entry API call (with attached stop-loss leg) "
            "during Phase 3. Spec non-negotiable #1: must default to paper "
            "trading for the first 90 days."
        )

    def get_position(self, symbol: str) -> dict:
        raise NotImplementedError(
            "AlpacaExecutionAdapter.get_position is a scaffold stub — implement "
            "the live Alpaca positions API call during Phase 3."
        )

    def cancel_all_orders(self) -> None:
        raise NotImplementedError(
            "AlpacaExecutionAdapter.cancel_all_orders is a scaffold stub — this "
            "is the kill-switch primitive and must be implemented before any "
            "paper or live trading begins."
        )
