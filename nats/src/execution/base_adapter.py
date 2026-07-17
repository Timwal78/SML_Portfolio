"""Shared interface for execution adapters.

Both adapters enforce spec non-negotiable #4 (no unhedged overnight gaps —
every order must carry a stop-loss) and honor `execution.no_trade_open_minutes`
/ `no_trade_close_minutes` from config.yaml (skip orders too close to the
open/close auction).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class OrderRequest:
    symbol: str
    side: str  # "buy" | "sell"
    qty: float
    stop_loss_price: float
    order_type: str = "market"


@dataclass
class OrderResult:
    order_id: str
    status: str
    filled_qty: float
    filled_avg_price: float | None


class BaseExecutionAdapter(ABC):
    @abstractmethod
    def submit_order(self, request: OrderRequest) -> OrderResult:
        raise NotImplementedError

    @abstractmethod
    def get_position(self, symbol: str) -> dict:
        raise NotImplementedError

    @abstractmethod
    def cancel_all_orders(self) -> None:
        """Kill-switch primitive — must always succeed synchronously (spec
        non-negotiable #10: human override always accessible)."""
        raise NotImplementedError
