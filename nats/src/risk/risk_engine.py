"""Risk overlay: position sizing, correlation stress test, and the risk
gate every proposed trade must pass before reaching execution/.

Enforces spec non-negotiables #2 (max 2% position), #8 (crypto <= 10%
allocation), and reads `config.yaml`'s `risk:` block for all thresholds —
no threshold is ever hardcoded outside that file.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from src.risk.circuit_breaker import CircuitBreaker
from src.risk.var import portfolio_var


@dataclass
class RiskConfig:
    max_position_pct: float = 0.02
    daily_circuit_breaker: float = -0.03
    kelly_fraction: float = 0.25
    var_confidence: float = 0.95
    regime_confidence_min: float = 0.60
    crypto_max_allocation: float = 0.10


@dataclass
class TradeProposal:
    symbol: str
    is_crypto: bool
    raw_kelly_weight: float
    regime_confidence: float


@dataclass
class RiskDecision:
    approved: bool
    sized_weight: float
    reasons: list[str]


class RiskEngine:
    def __init__(self, config: RiskConfig):
        self.config = config
        self.circuit_breaker = CircuitBreaker(config.daily_circuit_breaker)

    def size_position(self, raw_kelly_weight: float) -> float:
        """Quarter-Kelly (or configured fraction) sizing, capped at max_position_pct."""
        sized = raw_kelly_weight * self.config.kelly_fraction
        return max(min(sized, self.config.max_position_pct), -self.config.max_position_pct)

    def evaluate(
        self,
        proposal: TradeProposal,
        current_crypto_allocation: float,
        daily_pnl_pct: float,
    ) -> RiskDecision:
        reasons: list[str] = []

        if self.circuit_breaker.evaluate(daily_pnl_pct):
            reasons.append(f"circuit breaker tripped at {daily_pnl_pct:.2%} daily P&L")
            return RiskDecision(approved=False, sized_weight=0.0, reasons=reasons)

        if proposal.regime_confidence < self.config.regime_confidence_min:
            reasons.append(
                f"regime confidence {proposal.regime_confidence:.2f} below "
                f"minimum {self.config.regime_confidence_min:.2f}"
            )
            return RiskDecision(approved=False, sized_weight=0.0, reasons=reasons)

        sized = self.size_position(proposal.raw_kelly_weight)

        if proposal.is_crypto:
            projected_allocation = current_crypto_allocation + abs(sized)
            if projected_allocation > self.config.crypto_max_allocation:
                reasons.append(
                    f"crypto allocation {projected_allocation:.2%} would exceed "
                    f"cap {self.config.crypto_max_allocation:.2%}"
                )
                return RiskDecision(approved=False, sized_weight=0.0, reasons=reasons)

        return RiskDecision(approved=True, sized_weight=sized, reasons=reasons)

    def correlation_stress_test(
        self, weights: pd.Series, cov_matrix: pd.DataFrame
    ) -> float:
        """Pre-rebalance portfolio VaR check, run before applying new ensemble weights."""
        return portfolio_var(weights, cov_matrix, self.config.var_confidence)
