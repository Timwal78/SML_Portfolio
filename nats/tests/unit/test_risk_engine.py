import pytest

from src.risk.circuit_breaker import CircuitBreaker
from src.risk.risk_engine import RiskConfig, RiskEngine, TradeProposal


def test_circuit_breaker_trips_below_threshold():
    cb = CircuitBreaker(daily_circuit_breaker=-0.03)
    assert cb.evaluate(-0.01) is False
    assert cb.evaluate(-0.031) is True
    assert cb.is_tripped()


def test_circuit_breaker_rejects_positive_threshold():
    with pytest.raises(ValueError):
        CircuitBreaker(daily_circuit_breaker=0.03)


def test_risk_engine_caps_position_size():
    engine = RiskEngine(RiskConfig(max_position_pct=0.02, kelly_fraction=0.25))
    # raw kelly weight so large that quarter-Kelly would exceed the cap
    sized = engine.size_position(raw_kelly_weight=1.0)
    assert sized == pytest.approx(0.02)


def test_risk_engine_blocks_trade_below_regime_confidence():
    engine = RiskEngine(RiskConfig(regime_confidence_min=0.60))
    proposal = TradeProposal(symbol="IWM", is_crypto=False, raw_kelly_weight=0.5, regime_confidence=0.4)
    decision = engine.evaluate(proposal, current_crypto_allocation=0.0, daily_pnl_pct=0.0)
    assert decision.approved is False
    assert "regime confidence" in decision.reasons[0]


def test_risk_engine_blocks_crypto_over_allocation_cap():
    engine = RiskEngine(RiskConfig(crypto_max_allocation=0.10, kelly_fraction=1.0, max_position_pct=1.0))
    proposal = TradeProposal(symbol="BTCUSD", is_crypto=True, raw_kelly_weight=0.5, regime_confidence=0.9)
    decision = engine.evaluate(proposal, current_crypto_allocation=0.08, daily_pnl_pct=0.0)
    assert decision.approved is False
    assert "crypto allocation" in decision.reasons[0]


def test_risk_engine_approves_valid_trade():
    engine = RiskEngine(RiskConfig())
    proposal = TradeProposal(symbol="SPY", is_crypto=False, raw_kelly_weight=0.08, regime_confidence=0.9)
    decision = engine.evaluate(proposal, current_crypto_allocation=0.0, daily_pnl_pct=0.0)
    assert decision.approved is True
    assert decision.sized_weight == pytest.approx(0.02)  # capped at max_position_pct
