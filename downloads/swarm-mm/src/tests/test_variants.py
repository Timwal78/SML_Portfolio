"""Variant A/B/C service tests."""

from __future__ import annotations

import pytest

from swarm_mm.core.models import B2BConfigureRequest, B2BOptimizeRequest, CryptoDepositRequest
from swarm_mm.variants.a_signal import service as signal
from swarm_mm.variants.b_crypto import service as crypto
from swarm_mm.variants.c_b2b import service as b2b


def test_signal_levels_and_subscribe():
    lv = signal.levels("IWM", side="both", confidence_threshold=0.6)
    assert lv.ticker == "IWM"
    assert len(lv.levels) >= 1
    vm = signal.venue_map_for("IWM")
    assert vm.allocations
    reb = signal.rebate("u1", "IWM")
    assert reb.estimated_maker_rebate_usd >= 0
    sub = signal.subscribe("u1", broker="tradier")
    assert sub["plan_usd_mo"] == 19.0
    assert sub["execution"] == "user_broker_only"


def test_b2b_configure_optimize_report():
    cfg = b2b.configure(
        B2BConfigureRequest(customer_id="bd_acme", asset_universe=["SPY", "QQQ"], risk_params={"confidence_floor": 0.6})
    )
    assert cfg["customer_id"] == "bd_acme"
    assert cfg["license_usd_mo"] == 5000.0
    opt = b2b.optimize(B2BOptimizeRequest(customer_id="bd_acme", target="rebate_capture"))
    assert opt["symbols_optimized"] == 2
    assert "incremental_rebate_bps" in opt
    rep = b2b.report("bd_acme", "30d")
    assert rep["performance"]["fill_rate_est"] > 0


def test_crypto_geofence_blocks_us():
    req = CryptoDepositRequest(vault_id="v1", asset="USDC", amount=100, chain="base", non_us_attestation=False)
    with pytest.raises(PermissionError):
        crypto.deposit(req, user_id="us_person")


def test_crypto_deposit_withdraw_flow():
    req = CryptoDepositRequest(vault_id="v2", asset="USDC", amount=500, chain="base", non_us_attestation=True)
    dep = crypto.deposit(req, user_id="eu_user")
    assert dep["status"] == "accepted_offchain_scaffold"
    assert dep["custodial"] is False
    pos = crypto.positions("eu_user")
    assert "v2" in pos["vaults"]
    wd = crypto.withdraw("v2", "USDC", 100, "eu_user", non_us_attestation=True)
    assert wd["amount"] == 100
    reb = crypto.rebalance("v2", {"hyperliquid": 0.5, "dydx": 0.5}, non_us_attestation=True)
    assert abs(sum(reb["target_dex_weights"].values()) - 1.0) < 0.02
