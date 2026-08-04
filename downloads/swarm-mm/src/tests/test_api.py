"""API integration tests via TestClient."""

from __future__ import annotations

import os
import uuid

import pytest
from fastapi.testclient import TestClient

# Dev-open payment bypass for tests
os.environ["SWARM_MM_DEV_OPEN"] = "1"
os.environ.pop("SML_API_KEY", None)

from swarm_mm.api.app import app  # noqa: E402

client = TestClient(app)


def test_health_and_root():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert set(body["variants"]) == {"A", "B", "C", "D"}
    assert body["pay_to"].startswith("0x")

    r2 = client.get("/")
    assert r2.status_code == 200
    assert r2.json()["build_sequence"][0] == "D"


def test_well_known_x402():
    r = client.get("/.well-known/x402")
    assert r.status_code == 200
    data = r.json()
    assert data["x402Version"] == 1
    assert any(x["resource"] == "/v1/sim/join" for x in data["resources"])
    assert data["payTo"].lower().startswith("0x7233")


def test_sim_flow_e2e():
    uid = f"api_{uuid.uuid4().hex[:8]}"
    r = client.post("/v1/sim/join", json={"user_id": uid, "starting_balance": 100000})
    assert r.status_code == 200
    assert r.json()["account"]["cash"] == 100000

    # Get a mid via engine levels free path through sim is free; signal needs pay — use engine
    eng = client.get("/v1/engine")
    assert eng.status_code == 200

    # trade via MCP free tool
    tr = client.post(
        "/mcp/call",
        json={
            "tool": "sim_swarm.trade",
            "params": {"user_id": uid, "ticker": "SPY", "side": "buy", "price": 999999, "size": 1},
        },
    )
    assert tr.status_code == 200
    assert tr.json()["result"]["paper"] is True

    lb = client.get("/v1/sim/leaderboard")
    assert lb.status_code == 200
    assert lb.json()["paper"] is True


def test_signal_levels_dev_open():
    r = client.get("/v1/signal/levels", params={"ticker": "SPY", "side": "both", "confidence_threshold": 0.5})
    assert r.status_code == 200
    data = r.json()
    assert data["ticker"] == "SPY"
    assert len(data["levels"]) >= 1


def test_signal_402_when_key_required(monkeypatch):
    monkeypatch.setenv("SML_API_KEY", "test-secret-key-xyz")
    monkeypatch.setenv("SWARM_MM_DEV_OPEN", "0")
    # reload auth path — operator_authorized reads env live
    r = client.get("/v1/signal/levels", params={"ticker": "SPY"})
    assert r.status_code == 402
    body = r.json()
    assert body["x402Version"] == 1
    assert body["accepts"][0]["payTo"].lower().startswith("0x7233")
    # with operator key
    r2 = client.get(
        "/v1/signal/levels",
        params={"ticker": "SPY", "confidence_threshold": 0.5},
        headers={"X-Operator-Key": "test-secret-key-xyz"},
    )
    assert r2.status_code == 200
    # reset
    monkeypatch.setenv("SWARM_MM_DEV_OPEN", "1")
    monkeypatch.delenv("SML_API_KEY", raising=False)


def test_b2b_and_crypto_routes():
    r = client.post(
        "/v1/b2b/configure",
        json={"customer_id": "cust1", "asset_universe": ["SPY"], "risk_params": {}},
    )
    assert r.status_code == 200

    r2 = client.post("/v1/b2b/optimize", json={"customer_id": "cust1", "target": "rebate_capture"})
    assert r2.status_code == 200

    blocked = client.post(
        "/v1/crypto/deposit",
        json={"vault_id": "vx", "asset": "USDC", "amount": 10, "chain": "base", "non_us_attestation": False},
    )
    assert blocked.status_code == 403

    ok = client.post(
        "/v1/crypto/deposit?user_id=eu1",
        json={"vault_id": "vx", "asset": "USDC", "amount": 10, "chain": "base", "non_us_attestation": True},
    )
    assert ok.status_code == 200


def test_mcp_manifest():
    r = client.get("/mcp/tools")
    assert r.status_code == 200
    names = {t["name"] for t in r.json()["tools"]}
    assert "sim_swarm.join" in names
    assert "signal_swarm.levels" in names
    assert "b2b_swarm.optimize" in names
    assert "crypto_swarm.deposit" in names
