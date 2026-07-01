"""Daily circuit breaker (spec non-negotiable #3): halt all trading if
daily P&L drops below `risk.daily_circuit_breaker` (default -3%).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class CircuitBreakerState:
    tripped: bool = False
    tripped_at_pnl_pct: float | None = None


class CircuitBreaker:
    def __init__(self, daily_circuit_breaker: float = -0.03):
        if daily_circuit_breaker >= 0:
            raise ValueError("daily_circuit_breaker must be a negative fraction, e.g. -0.03")
        self.threshold = daily_circuit_breaker
        self.state = CircuitBreakerState()

    def evaluate(self, daily_pnl_pct: float) -> bool:
        """Returns True if trading should halt for the remainder of the session."""
        if daily_pnl_pct <= self.threshold:
            self.state = CircuitBreakerState(tripped=True, tripped_at_pnl_pct=daily_pnl_pct)
        return self.state.tripped

    def reset_for_new_session(self) -> None:
        self.state = CircuitBreakerState()

    def is_tripped(self) -> bool:
        return self.state.tripped
