"""Variant D sim swarm tests."""

from __future__ import annotations

import uuid

from swarm_mm.core.config import Side, Variant
from swarm_mm.core.models import SimJoinRequest, SimTradeRequest, UpgradeRequest
from swarm_mm.variants.d_sim import service as sim


def _uid() -> str:
    return f"trader_{uuid.uuid4().hex[:10]}"


def test_join_and_account():
    uid = _uid()
    acct = sim.join(SimJoinRequest(user_id=uid, starting_balance=100_000))
    assert acct.user_id == uid
    assert acct.cash == 100_000
    assert acct.equity == 100_000
    again = sim.join(SimJoinRequest(user_id=uid, starting_balance=50_000))
    assert again.cash == 100_000  # idempotent


def test_trade_buy_and_leaderboard():
    uid = _uid()
    sim.join(SimJoinRequest(user_id=uid, starting_balance=100_000))
    # Place aggressive buy to force fill
    from swarm_mm.core.engine import fetch_quote

    q = fetch_quote("SPY")
    out = sim.trade(
        SimTradeRequest(user_id=uid, ticker="SPY", side=Side.BUY, price=q.ask * 1.01, size=10)
    )
    assert out["status"] in ("filled", "resting")
    assert out["paper"] is True
    if out["status"] == "filled":
        assert out["account"]["fills"] >= 1
        assert out["account"]["cash"] < 100_000

    board = sim.leaderboard("all_time")
    assert board.paper is True
    assert any(e.user_id == uid for e in board.entries)


def test_upgrade_path():
    uid = _uid()
    sim.join(SimJoinRequest(user_id=uid, starting_balance=25_000))
    up = sim.upgrade(UpgradeRequest(user_id=uid, target_variant=Variant.A_SIGNAL))
    assert up["target_variant"] == "A"
    assert up["status"] == "pending_onboarding"
    assert "broker" in up["next"].lower() or "Connect" in up["next"]


def test_insufficient_cash():
    uid = _uid()
    sim.join(SimJoinRequest(user_id=uid, starting_balance=10_000))
    from swarm_mm.core.engine import fetch_quote

    q = fetch_quote("AMZN")
    try:
        sim.trade(SimTradeRequest(user_id=uid, ticker="AMZN", side=Side.BUY, price=q.ask * 1.05, size=1_000_000))
        assert False, "should have raised"
    except ValueError as e:
        assert "cash" in str(e).lower() or "insufficient" in str(e).lower()
