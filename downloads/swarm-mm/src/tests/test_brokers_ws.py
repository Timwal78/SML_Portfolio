"""Broker adapter + WebSocket unit tests."""

from __future__ import annotations

import json
import os

import pytest
from fastapi.testclient import TestClient

os.environ["SWARM_MM_DEV_OPEN"] = "1"
os.environ.pop("SML_API_KEY", None)

from swarm_mm.api.app import app
from swarm_mm.variants.a_signal.brokers import list_brokers, preview_orders

client = TestClient(app)


def test_list_brokers():
    brokers = list_brokers()
    ids = {b["id"] for b in brokers}
    assert {"alpaca", "tradier", "ibkr"} <= ids


def test_alpaca_order_preview_no_submit():
    out = preview_orders("alpaca", "SPY", side="buy", confidence_threshold=0.5, max_levels=2)
    assert out["broker"] == "alpaca"
    assert out["submit"] is False
    assert out["execution"] == "user_broker_only"
    assert len(out["orders"]) >= 1
    o = out["orders"][0]
    assert o["type"] == "limit"
    assert "api.alpaca.markets" in o["endpoint"]


def test_tradier_and_ibkr_shapes():
    t = preview_orders("tradier", "QQQ", side="sell", confidence_threshold=0.5, max_levels=1)
    assert t["orders"][0]["class"] == "equity"
    i = preview_orders("ibkr", "IWM", side="buy", confidence_threshold=0.5, max_levels=1)
    assert i["orders"][0]["orderType"] == "LMT"


def test_broker_http_routes():
    r = client.get("/v1/signal/brokers")
    assert r.status_code == 200
    assert r.json()["execution"] == "user_broker_only"

    r2 = client.get(
        "/v1/signal/broker-orders",
        params={"ticker": "SPY", "broker": "alpaca", "confidence_threshold": 0.5},
    )
    assert r2.status_code == 200
    assert r2.json()["submit"] is False

    r3 = client.post(
        "/mcp/call",
        json={"tool": "signal_swarm.broker_orders", "params": {"ticker": "MSFT", "broker": "tradier", "confidence_threshold": 0.5}},
    )
    assert r3.status_code == 200
    assert r3.json()["result"]["broker"] == "tradier"


def test_ws_signals_subscribe():
    with client.websocket_connect("/ws/signals") as ws:
        hello = json.loads(ws.receive_text())
        assert hello["type"] == "hello"
        ws.send_text(json.dumps({"op": "subscribe", "ticker": "SPY"}))
        snap = json.loads(ws.receive_text())
        assert snap["type"] == "snapshot"
        assert snap["ticker"] == "SPY"
        assert "levels" in snap
        ws.send_text(json.dumps({"op": "ping"}))
        pong = json.loads(ws.receive_text())
        assert pong["type"] == "pong"
        ws.send_text(json.dumps({"op": "leaderboard"}))
        board = json.loads(ws.receive_text())
        assert board["type"] == "leaderboard"


def test_root_exposes_ws_and_brokers():
    r = client.get("/")
    body = r.json()
    assert body["websocket"] == "/ws/signals"
    assert body["brokers"] == "/v1/signal/brokers"

    st = client.get("/v1/ws/stats")
    assert st.status_code == 200
    assert "clients" in st.json()
