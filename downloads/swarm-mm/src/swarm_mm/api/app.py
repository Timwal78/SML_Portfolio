"""FastAPI application — Swarm Market Making 4-variant suite."""

from __future__ import annotations

import os
from typing import Any, Optional

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from pathlib import Path

from swarm_mm import __version__
from swarm_mm.billing.x402 import (
    PaymentRequired,
    get_pay_to,
    operator_authorized,
    payment_response,
    require_payment_or_operator,
    well_known_resources,
    x402_challenge,
)
from swarm_mm.core.config import (
    DISCLAIMER,
    PRICE_B2B_OPTIMIZE_USD,
    PRICE_B2B_REPORT_USD,
    PRICE_LEVELS_CALL_USD,
    PRICE_REBATE_TRACKER_USD,
    PRICE_SIGNAL_SUB_USD,
    PRICE_SIM_PREMIUM_USD,
    PRICE_VENUE_MAP_USD,
    SML_PAYMENT_RECEIVER,
    Side,
    Variant,
)
from swarm_mm.core.engine import engine_info
from swarm_mm.core.models import (
    B2BConfigureRequest,
    B2BOptimizeRequest,
    CryptoDepositRequest,
    HealthResponse,
    LevelRequest,
    SimJoinRequest,
    SimTradeRequest,
    UpgradeRequest,
)
from swarm_mm.mcp.tools import dispatch as mcp_dispatch
from swarm_mm.mcp.tools import manifest as mcp_manifest
from swarm_mm.api.ws import hub, router as ws_router
from swarm_mm.variants.a_signal import service as signal
from swarm_mm.variants.a_signal import brokers as broker_adapters
from swarm_mm.variants.b_crypto import service as crypto
from swarm_mm.variants.c_b2b import service as b2b
from swarm_mm.variants.d_sim import service as sim

app = FastAPI(
    title="Swarm Market Making API",
    description=(
        "Script Master Labs — 4-variant swarm MM suite "
        "(A Signal / B Crypto / C B2B / D Simulated). "
        + DISCLAIMER
    ),
    version=__version__,
    contact={"name": "Script Master Labs", "email": "timothy.walton45@gmail.com"},
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("SWARM_MM_CORS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ws_router)

_STATIC = Path(__file__).resolve().parent.parent / "static"


@app.get("/landing", include_in_schema=False)
def landing_page():
    idx = _STATIC / "index.html"
    if idx.exists():
        return FileResponse(idx)
    return JSONResponse({"product": "swarm-mm", "docs": "/docs"})


@app.exception_handler(PaymentRequired)
async def _payment_required_handler(_req: Request, exc: PaymentRequired):
    return payment_response(exc.price_usd, exc.resource, exc.description)


@app.exception_handler(PermissionError)
async def _perm_handler(_req: Request, exc: PermissionError):
    return JSONResponse(status_code=403, content={"error": "forbidden", "detail": str(exc), "disclaimer": DISCLAIMER})


@app.exception_handler(ValueError)
async def _value_handler(_req: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"error": "bad_request", "detail": str(exc), "disclaimer": DISCLAIMER})


# ── Health / discovery ───────────────────────────────────────────────────────


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        version=__version__,
        variants=["A", "B", "C", "D"],
        pay_to=get_pay_to(),
        paper_default=True,
    )


@app.get("/")
def root() -> dict[str, Any]:
    return {
        "product": "swarm-mm",
        "version": __version__,
        "company": "Script Master Labs",
        "variants": {
            "A": "Signal Swarm — $19/mo SaaS, user broker execution",
            "B": "Crypto-Only Swarm — DEX vault, US geofenced",
            "C": "B2B Swarm Engine — white-label for licensed entities",
            "D": "Simulated Swarm — paper POC (launch first)",
        },
        "docs": "/docs",
        "openapi": "/openapi.json",
        "well_known_x402": "/.well-known/x402",
        "mcp": "/mcp/tools",
        "websocket": "/ws/signals",
        "brokers": "/v1/signal/brokers",
        "pay_to": get_pay_to(),
        "disclaimer": DISCLAIMER,
        "build_sequence": ["D", "A", "C", "B"],
    }


@app.get("/.well-known/x402")
def well_known_x402() -> dict[str, Any]:
    return well_known_resources()


@app.get("/v1/engine")
def engine() -> dict[str, Any]:
    return engine_info()


# ── Variant D — Simulated ────────────────────────────────────────────────────


@app.post("/v1/sim/join")
def sim_join(body: SimJoinRequest) -> dict[str, Any]:
    acct = sim.join(body)
    return {"status": "ok", "account": acct.model_dump(mode="json"), "paper": True, "disclaimer": DISCLAIMER}


@app.post("/v1/sim/trade")
def sim_trade(body: SimTradeRequest) -> dict[str, Any]:
    return sim.trade(body)


@app.get("/v1/sim/account/{user_id}")
def sim_account(user_id: str) -> dict[str, Any]:
    acct = sim.get_account(user_id)
    if not acct:
        raise HTTPException(status_code=404, detail="user not found — join first")
    return {"account": acct.model_dump(mode="json"), "paper": True}


@app.get("/v1/sim/leaderboard")
def sim_leaderboard(timeframe: str = Query(default="all_time", pattern="^(daily|weekly|all_time)$")) -> dict[str, Any]:
    return sim.leaderboard(timeframe).model_dump(mode="json")


@app.post("/v1/sim/upgrade")
def sim_upgrade(body: UpgradeRequest) -> dict[str, Any]:
    return sim.upgrade(body)


@app.post("/v1/sim/premium")
async def sim_premium(
    request: Request,
    user_id: str,
    x_operator_key: Optional[str] = Header(default=None, alias="X-Operator-Key"),
    x_payment: Optional[str] = Header(default=None, alias="X-PAYMENT"),
) -> dict[str, Any]:
    try:
        pay = await require_payment_or_operator(
            request,
            PRICE_SIM_PREMIUM_USD,
            "/v1/sim/premium",
            "Sim premium analytics $9/mo",
            x_operator_key=x_operator_key,
            x_payment=x_payment,
        )
    except PaymentRequired as e:
        raise e
    acct = sim.set_premium(user_id, True)
    return {"status": "premium_active", "payment": pay, "account": acct.model_dump(mode="json"), "price_usd_mo": PRICE_SIM_PREMIUM_USD}


# ── Variant A — Signal ───────────────────────────────────────────────────────


@app.get("/v1/signal/levels")
async def signal_levels(
    request: Request,
    ticker: str,
    side: str = "both",
    confidence_threshold: float = 0.75,
    notional_usd: Optional[float] = None,
    depth: int = 5,
    x_operator_key: Optional[str] = Header(default=None, alias="X-Operator-Key"),
    x_payment: Optional[str] = Header(default=None, alias="X-PAYMENT"),
) -> dict[str, Any]:
    await require_payment_or_operator(
        request, PRICE_LEVELS_CALL_USD, "/v1/signal/levels", "signal levels", x_operator_key=x_operator_key, x_payment=x_payment
    )
    res = signal.levels(ticker, side=side, confidence_threshold=confidence_threshold, notional_usd=notional_usd, depth=depth)
    return res.model_dump(mode="json")


@app.get("/v1/signal/venue-map")
async def signal_venue_map(
    request: Request,
    ticker: str,
    x_operator_key: Optional[str] = Header(default=None, alias="X-Operator-Key"),
    x_payment: Optional[str] = Header(default=None, alias="X-PAYMENT"),
) -> dict[str, Any]:
    await require_payment_or_operator(
        request, PRICE_VENUE_MAP_USD, "/v1/signal/venue-map", "venue map", x_operator_key=x_operator_key, x_payment=x_payment
    )
    return signal.venue_map_for(ticker).model_dump(mode="json")


@app.get("/v1/signal/rebate-tracker")
async def signal_rebate(
    request: Request,
    user_id: str,
    ticker: str,
    notional_usd: float = 100_000,
    x_operator_key: Optional[str] = Header(default=None, alias="X-Operator-Key"),
    x_payment: Optional[str] = Header(default=None, alias="X-PAYMENT"),
) -> dict[str, Any]:
    await require_payment_or_operator(
        request,
        PRICE_REBATE_TRACKER_USD,
        "/v1/signal/rebate-tracker",
        "rebate tracker",
        x_operator_key=x_operator_key,
        x_payment=x_payment,
    )
    return signal.rebate(user_id, ticker, notional_usd).model_dump(mode="json")


@app.post("/v1/signal/subscribe")
async def signal_subscribe(
    request: Request,
    user_id: str,
    broker: str = "alpaca",
    x_operator_key: Optional[str] = Header(default=None, alias="X-Operator-Key"),
    x_payment: Optional[str] = Header(default=None, alias="X-PAYMENT"),
) -> dict[str, Any]:
    await require_payment_or_operator(
        request,
        PRICE_SIGNAL_SUB_USD,
        "/v1/signal/subscribe",
        "Signal Swarm $19/mo",
        x_operator_key=x_operator_key,
        x_payment=x_payment,
    )
    return signal.subscribe(user_id, broker=broker)


@app.get("/v1/signal/subscription/{user_id}")
def signal_sub_status(user_id: str) -> dict[str, Any]:
    return signal.subscription_status(user_id)


@app.get("/v1/signal/brokers")
def signal_brokers() -> dict[str, Any]:
    return {
        "brokers": broker_adapters.list_brokers(),
        "execution": "user_broker_only",
        "note": "Swarm formats order payloads; user submits via their own brokerage credentials.",
        "disclaimer": DISCLAIMER,
    }


@app.get("/v1/signal/broker-orders")
async def signal_broker_orders(
    request: Request,
    ticker: str,
    broker: str = "alpaca",
    side: str = "both",
    confidence_threshold: float = 0.75,
    max_levels: int = 3,
    x_operator_key: Optional[str] = Header(default=None, alias="X-Operator-Key"),
    x_payment: Optional[str] = Header(default=None, alias="X-PAYMENT"),
) -> dict[str, Any]:
    """Preview broker-native limit orders from swarm levels. Does NOT submit."""
    await require_payment_or_operator(
        request,
        PRICE_LEVELS_CALL_USD,
        "/v1/signal/broker-orders",
        "broker order preview",
        x_operator_key=x_operator_key,
        x_payment=x_payment,
    )
    return broker_adapters.preview_orders(
        broker=broker,
        ticker=ticker,
        side=side,
        confidence_threshold=confidence_threshold,
        max_levels=max_levels,
    )


@app.get("/v1/ws/stats")
def ws_stats() -> dict[str, Any]:
    return {"clients": hub.client_count, "path": "/ws/signals"}


# ── Variant C — B2B ──────────────────────────────────────────────────────────


@app.post("/v1/b2b/configure")
def b2b_configure(body: B2BConfigureRequest) -> dict[str, Any]:
    return b2b.configure(body)


@app.post("/v1/b2b/optimize")
async def b2b_optimize(
    request: Request,
    body: B2BOptimizeRequest,
    x_operator_key: Optional[str] = Header(default=None, alias="X-Operator-Key"),
    x_payment: Optional[str] = Header(default=None, alias="X-PAYMENT"),
) -> dict[str, Any]:
    await require_payment_or_operator(
        request, PRICE_B2B_OPTIMIZE_USD, "/v1/b2b/optimize", "b2b optimize", x_operator_key=x_operator_key, x_payment=x_payment
    )
    return b2b.optimize(body)


@app.get("/v1/b2b/report")
async def b2b_report(
    request: Request,
    customer_id: str,
    period: str = "30d",
    x_operator_key: Optional[str] = Header(default=None, alias="X-Operator-Key"),
    x_payment: Optional[str] = Header(default=None, alias="X-PAYMENT"),
) -> dict[str, Any]:
    await require_payment_or_operator(
        request, PRICE_B2B_REPORT_USD, "/v1/b2b/report", "b2b report", x_operator_key=x_operator_key, x_payment=x_payment
    )
    return b2b.report(customer_id, period)


# ── Variant B — Crypto ───────────────────────────────────────────────────────


@app.post("/v1/crypto/deposit")
def crypto_deposit(body: CryptoDepositRequest, user_id: str = "anonymous") -> dict[str, Any]:
    return crypto.deposit(body, user_id=user_id)


@app.get("/v1/crypto/positions")
async def crypto_positions(
    request: Request,
    user_id: str,
    x_operator_key: Optional[str] = Header(default=None, alias="X-Operator-Key"),
    x_payment: Optional[str] = Header(default=None, alias="X-PAYMENT"),
) -> dict[str, Any]:
    await require_payment_or_operator(
        request, PRICE_LEVELS_CALL_USD, "/v1/crypto/positions", "crypto positions", x_operator_key=x_operator_key, x_payment=x_payment
    )
    return crypto.positions(user_id)


@app.post("/v1/crypto/withdraw")
def crypto_withdraw(
    vault_id: str,
    asset: str,
    amount: float,
    user_id: str = "anonymous",
    non_us_attestation: bool = False,
) -> dict[str, Any]:
    return crypto.withdraw(vault_id, asset, amount, user_id, non_us_attestation)


@app.post("/v1/crypto/rebalance")
def crypto_rebalance(
    vault_id: str,
    target_dex_weights: dict[str, float],
    non_us_attestation: bool = False,
) -> dict[str, Any]:
    return crypto.rebalance(vault_id, target_dex_weights, non_us_attestation)


# ── MCP ──────────────────────────────────────────────────────────────────────


@app.get("/mcp/tools")
def mcp_tools() -> dict[str, Any]:
    return mcp_manifest()


@app.post("/mcp/call")
async def mcp_call(
    request: Request,
    body: dict[str, Any],
    x_operator_key: Optional[str] = Header(default=None, alias="X-Operator-Key"),
) -> dict[str, Any]:
    tool = body.get("tool") or body.get("name")
    params = body.get("params") or body.get("arguments") or {}
    if not tool:
        raise HTTPException(status_code=400, detail="tool required")
    # Free tools always; paid tools need operator or soft payment handled inside variants
    try:
        result = mcp_dispatch(tool, params)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"tool": tool, "result": result}


@app.get("/v1/pricing")
def pricing() -> dict[str, Any]:
    return {
        "A_signal_subscription_usd_mo": PRICE_SIGNAL_SUB_USD,
        "A_levels_call_usd": PRICE_LEVELS_CALL_USD,
        "D_sim_free": True,
        "D_premium_usd_mo": PRICE_SIM_PREMIUM_USD,
        "C_platform_usd_mo": 5000.0,
        "C_optimize_usd": PRICE_B2B_OPTIMIZE_USD,
        "B_rebate_share": 0.005,
        "pay_to": get_pay_to(),
        "sample_402": x402_challenge(0.001, "/v1/signal/levels"),
    }


def main() -> None:
    import uvicorn

    host = os.environ.get("SWARM_MM_HOST", "0.0.0.0")
    port = int(os.environ.get("SWARM_MM_PORT", "8088"))
    uvicorn.run("swarm_mm.api.app:app", host=host, port=port, reload=os.environ.get("SWARM_MM_RELOAD") == "1")


if __name__ == "__main__":
    main()
