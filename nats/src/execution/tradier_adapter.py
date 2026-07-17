"""Tradier execution adapter — equities and options order routing.

Required env vars: TRADIER_ACCESS_TOKEN, TRADIER_SANDBOX
"""

from __future__ import annotations

from src.data.base_client import UpstreamUnavailableError
from src.execution.base_adapter import BaseExecutionAdapter, OrderRequest, OrderResult


class TradierExecutionAdapter(BaseExecutionAdapter):
    def __init__(self, access_token: str, sandbox: bool = True):
        if not access_token:
            raise UpstreamUnavailableError("TradierExecutionAdapter requires TRADIER_ACCESS_TOKEN")
        self._access_token = access_token
        self._sandbox = sandbox

    def submit_order(self, request: OrderRequest) -> OrderResult:
        raise NotImplementedError(
            "TradierExecutionAdapter.submit_order is a scaffold stub — implement "
            "the live Tradier order-entry API call (with attached stop-loss leg) "
            "during Phase 3."
        )

    def get_position(self, symbol: str) -> dict:
        raise NotImplementedError(
            "TradierExecutionAdapter.get_position is a scaffold stub — implement "
            "the live Tradier positions API call during Phase 3."
        )

    def cancel_all_orders(self) -> None:
        raise NotImplementedError(
            "TradierExecutionAdapter.cancel_all_orders is a scaffold stub — this "
            "is the kill-switch primitive and must be implemented before any "
            "paper or live trading begins."
        )
