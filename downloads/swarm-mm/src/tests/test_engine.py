"""Core engine unit tests."""

from __future__ import annotations

from swarm_mm.core.config import Side, Variant
from swarm_mm.core.engine import compute_levels, synthetic_quote, venue_map, rebate_tracker
from swarm_mm.core.models import LevelRequest


def test_synthetic_quote_deterministic():
    a = synthetic_quote("SPY", now=1_700_000_000.0)
    b = synthetic_quote("SPY", now=1_700_000_000.0)
    assert a.mid == b.mid
    assert a.bid < a.mid < a.ask
    assert a.source == "synthetic_disclosed"


def test_compute_levels_both_sides():
    res = compute_levels(
        LevelRequest(ticker="AAPL", side=Side.BOTH, confidence_threshold=0.5, depth=5),
        variant=Variant.A_SIGNAL,
        paper=True,
    )
    assert res.ticker == "AAPL"
    assert res.mid > 0
    assert len(res.levels) >= 2
    sides = {lv.side for lv in res.levels}
    assert Side.BUY in sides and Side.SELL in sides
    assert res.paper is True
    assert "disclaimer" in res.disclaimer.lower() or "Educational" in res.disclaimer


def test_confidence_filter():
    loose = compute_levels(LevelRequest(ticker="MSFT", side=Side.BUY, confidence_threshold=0.1, depth=8), paper=True)
    tight = compute_levels(LevelRequest(ticker="MSFT", side=Side.BUY, confidence_threshold=0.95, depth=8), paper=True)
    assert len(loose.levels) >= len(tight.levels)


def test_venue_map_sums_near_one():
    compute_levels(LevelRequest(ticker="QQQ", side=Side.BOTH, confidence_threshold=0.5), paper=True)
    vm = venue_map("QQQ")
    total = sum(a.weight for a in vm.allocations)
    assert 0.99 <= total <= 1.01
    assert "IEX" in vm.summary or "Place" in vm.summary


def test_rebate_tracker_positive():
    r = rebate_tracker("user1", "SPY", notional_usd=100_000)
    assert r.estimated_maker_rebate_usd > 0
    assert r.bps_rebate > 0
