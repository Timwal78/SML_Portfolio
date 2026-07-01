"""Alpaca execution adapter — paper trading, fractional shares, crypto.

Uses the `alpaca-py` SDK (the current official client; the older
`alpaca-trade-api` package is deprecated upstream). Every order is
submitted as a bracket order with an attached stop-loss leg, per spec
non-negotiable #4 (no unhedged overnight gaps).

Required env vars: ALPACA_API_KEY, ALPACA_SECRET_KEY, ALPACA_PAPER
"""

from __future__ import annotations

from alpaca.common.exceptions import APIError
from alpaca.trading.client import TradingClient
from alpaca.trading.enums import OrderClass, OrderSide, TimeInForce
from alpaca.trading.requests import GetOrdersRequest, MarketOrderRequest, StopLossRequest

from src.data.base_client import UpstreamUnavailableError
from src.execution.base_adapter import BaseExecutionAdapter, OrderRequest, OrderResult


class AlpacaExecutionAdapter(BaseExecutionAdapter):
    def __init__(self, api_key: str, secret_key: str, paper: bool = True):
        if not api_key or not secret_key:
            raise UpstreamUnavailableError(
                "AlpacaExecutionAdapter requires ALPACA_API_KEY and ALPACA_SECRET_KEY"
            )
        self._paper = paper
        self._client = TradingClient(api_key, secret_key, paper=paper)

    def submit_order(self, request: OrderRequest) -> OrderResult:
        side = OrderSide.BUY if request.side == "buy" else OrderSide.SELL
        order_request = MarketOrderRequest(
            symbol=request.symbol,
            qty=request.qty,
            side=side,
            time_in_force=TimeInForce.DAY,
            order_class=OrderClass.BRACKET,
            stop_loss=StopLossRequest(stop_price=request.stop_loss_price),
        )
        try:
            order = self._client.submit_order(order_request)
        except APIError as exc:
            raise UpstreamUnavailableError(f"Alpaca order submission failed: {exc}") from exc

        return OrderResult(
            order_id=str(order.id),
            status=str(order.status.value if hasattr(order.status, "value") else order.status),
            filled_qty=float(order.filled_qty or 0),
            filled_avg_price=float(order.filled_avg_price) if order.filled_avg_price else None,
        )

    def get_position(self, symbol: str) -> dict:
        try:
            position = self._client.get_open_position(symbol)
        except APIError as exc:
            if "position does not exist" in str(exc).lower():
                return {}
            raise UpstreamUnavailableError(f"Alpaca get_position({symbol}) failed: {exc}") from exc

        return {
            "symbol": position.symbol,
            "qty": float(position.qty),
            "avg_entry_price": float(position.avg_entry_price),
            "market_value": float(position.market_value),
            "unrealized_pl": float(position.unrealized_pl),
        }

    def cancel_all_orders(self) -> None:
        """Kill-switch primitive (spec non-negotiable #10). Cancels every
        open order; does not touch existing filled positions.
        """
        try:
            self._client.cancel_orders()
        except APIError as exc:
            raise UpstreamUnavailableError(f"Alpaca cancel_all_orders failed: {exc}") from exc

    def get_open_orders(self) -> list[dict]:
        orders = self._client.get_orders(filter=GetOrdersRequest(status="open"))
        return [{"id": str(o.id), "symbol": o.symbol, "side": o.side.value, "qty": o.qty} for o in orders]

    def get_account(self) -> dict:
        account = self._client.get_account()
        return {
            "equity": float(account.equity),
            "last_equity": float(account.last_equity),
            "cash": float(account.cash),
            "buying_power": float(account.buying_power),
            "portfolio_value": float(account.portfolio_value),
        }
