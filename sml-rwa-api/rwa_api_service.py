"""SML RWA API — real x402 v2 challenges (x402scan-compatible).

Free lead: GET /x402/rwa-assets
Paid: valuation / proof-of-reserves / intelligence / aggregates
Discovery: /.well-known/x402  OpenAPI 3.1 + x-payment-info
402 body + PAYMENT-REQUIRED / X-PAYMENT-REQUIRED base64 headers
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse, Response

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("sml-rwa-api")

APP_NAME = "SML RWA Intelligence Suite"
VERSION = "1.1.0"
BASE_URL = os.getenv("PUBLIC_BASE_URL", "https://sml-rwa-api.onrender.com").rstrip("/")
NETWORK = os.getenv("X402_NETWORK", "base")
PAY_TO = os.getenv("X402_PAY_TO", "0x72330994f379a71542e7bd5a4cf99a9d9743f4aa")
USDC = os.getenv("X402_USDC", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")
FACILITATOR = os.getenv("X402_FACILITATOR", "https://x402.org/facilitator").rstrip("/")
MAX_TIMEOUT = int(os.getenv("X402_MAX_TIMEOUT", "300"))
X402_VERSION = 2

PRICES = {
    "rwa-assets": "0.00",  # free lead-gen
    "rwa-valuation": "0.15",
    "proof-of-reserves": "0.20",
    "rwa-intelligence": "0.20",
    "rwa-aggregates": "0.25",
    "rwa-risk": "0.10",
}

app = FastAPI(title=APP_NAME, version=VERSION, docs_url="/docs", redoc_url=None)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None = None) -> str:
    return (dt or _now()).isoformat()


def _usdc_units(price: str) -> str:
    return str(int(round(float(price) * 1_000_000)))


# ---------------------------------------------------------------------------
# Demo universe (honest synthetic — not audited NAV)
# ---------------------------------------------------------------------------
_ASSETS: list[dict[str, Any]] = [
    {
        "asset_id": "rwa-000001",
        "ticker": "SHV",
        "name": "US Treasury Bond ETF",
        "asset_class": "fixed_income",
        "current_value_usd": 45_000_000,
        "daily_volume": 2_500_000,
        "risk_score": 15,
        "isin": "US4642874576",
        "por_hash": hashlib.sha256(b"rwa-000001-por-v1").hexdigest(),
    },
    {
        "asset_id": "rwa-000002",
        "ticker": "BUIDL",
        "name": "BlackRock USD Institutional Digital Liquidity Fund",
        "asset_class": "tokenized_treasuries",
        "current_value_usd": 520_000_000,
        "daily_volume": 12_000_000,
        "risk_score": 12,
        "isin": "US09260C1070",
        "por_hash": hashlib.sha256(b"rwa-000002-por-v1").hexdigest(),
    },
    {
        "asset_id": "rwa-000003",
        "ticker": "OUSG",
        "name": "Ondo Short-Term US Government Treasuries",
        "asset_class": "tokenized_treasuries",
        "current_value_usd": 310_000_000,
        "daily_volume": 8_400_000,
        "risk_score": 18,
        "isin": "US68277W1036",
        "por_hash": hashlib.sha256(b"rwa-000003-por-v1").hexdigest(),
    },
    {
        "asset_id": "rwa-000004",
        "ticker": "LCP-Q3",
        "name": "Senior Secured Loan Pool Q3 2026",
        "asset_class": "private_credit",
        "current_value_usd": 120_000_000,
        "daily_volume": 900_000,
        "risk_score": 38,
        "isin": "US2345678901",
        "por_hash": hashlib.sha256(b"rwa-000004-por-v1").hexdigest(),
    },
    {
        "asset_id": "rwa-000005",
        "ticker": "NYC-A",
        "name": "Manhattan Class A Commercial",
        "asset_class": "real_estate",
        "current_value_usd": 45_500_000,
        "daily_volume": 120_000,
        "risk_score": 42,
        "isin": "US1234567890",
        "por_hash": hashlib.sha256(b"rwa-000005-por-v1").hexdigest(),
    },
]


def _get_asset(asset_id: str) -> dict[str, Any] | None:
    for a in _ASSETS:
        if a["asset_id"] == asset_id or a.get("ticker", "").upper() == asset_id.upper():
            return a
    return None


# ---------------------------------------------------------------------------
# x402 challenge helpers
# ---------------------------------------------------------------------------
def _bazaar(method: str = "GET", query_params: dict | None = None) -> dict:
    qp = query_params or {}
    flat: dict[str, Any] = {}
    schema_props: dict[str, Any] = {}
    for k, v in qp.items():
        if isinstance(v, dict) and "type" in v:
            schema_props[k] = v
            if "example" in v:
                flat[k] = v["example"]
            elif "default" in v:
                flat[k] = v["default"]
            elif v.get("type") in ("integer", "number"):
                flat[k] = 0
            elif v.get("type") == "boolean":
                flat[k] = False
            else:
                flat[k] = ""
        else:
            flat[k] = "" if v is None else v
            schema_props[k] = {"type": "string"}
    return {
        "bazaar": {
            "discoverable": True,
            "info": {
                "input": {"type": "http", "method": method, "queryParams": flat},
                "output": {"example": {}},
            },
            "schema": {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {
                    "input": {
                        "type": "object",
                        "properties": {
                            "type": {"type": "string", "const": "http"},
                            "method": {"type": "string"},
                            "queryParams": {"type": "object", "properties": schema_props},
                        },
                        "required": ["type", "method"],
                    },
                    "output": {"properties": {"example": {}}},
                },
                "required": ["input"],
            },
        }
    }


def _accept(resource: str, price: str, description: str) -> dict:
    units = _usdc_units(price)
    return {
        "scheme": "exact",
        "network": NETWORK,
        "amount": units,
        "maxAmountRequired": units,
        "asset": USDC,
        "payTo": PAY_TO,
        "maxTimeoutSeconds": MAX_TIMEOUT,
        "resource": resource,
        "description": description,
        "mimeType": "application/json",
        "extra": {"name": "USD Coin", "version": "2"},
    }


def payment_required(
    path: str,
    price: str,
    description: str,
    query_params: dict | None = None,
    reason: str = "payment_required",
) -> JSONResponse:
    resource = f"{BASE_URL}{path}"
    body = {
        "x402Version": X402_VERSION,
        "error": reason,
        "resource": {
            "url": resource,
            "description": description,
            "mimeType": "application/json",
        },
        "accepts": [_accept(resource, price, description)],
        "extensions": _bazaar("GET", query_params),
    }
    header402 = base64.b64encode(
        json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).decode("ascii")
    return JSONResponse(
        status_code=402,
        content=body,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "PAYMENT-REQUIRED": header402,
            "X-PAYMENT-REQUIRED": header402,
            "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, X-PAYMENT-REQUIRED, X-PAYMENT-RESPONSE",
            "Access-Control-Allow-Origin": "*",
        },
    )


def _header_payment(request: Request) -> str | None:
    return (
        request.headers.get("X-PAYMENT")
        or request.headers.get("x-payment")
        or request.headers.get("X-Payment")
        or request.headers.get("PAYMENT-SIGNATURE")
    )


def _facilitator(path: str, payment_payload: dict, requirements: dict) -> dict:
    url = f"{FACILITATOR}{path}"
    data = json.dumps({"x402Version": X402_VERSION, "paymentPayload": payment_payload, "paymentRequirements": requirements}).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "sml-rwa-api/1.1"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode("utf-8", "replace"))
        except Exception:
            return {"isValid": False, "invalidReason": f"facilitator_http_{e.code}"}
    except Exception as e:
        return {"isValid": False, "invalidReason": str(e)[:200]}


def require_payment(
    request: Request,
    path: str,
    price: str,
    description: str,
    query_params: dict | None = None,
) -> JSONResponse | None:
    """Return 402 response if unpaid; None if payment verified or price is free."""
    if float(price) <= 0:
        return None
    resource = f"{BASE_URL}{path}"
    requirements = _accept(resource, price, description)
    raw = _header_payment(request)
    if not raw:
        return payment_required(path, price, description, query_params)
    try:
        if raw.strip().startswith("{"):
            payload = json.loads(raw)
        else:
            pad = "=" * ((4 - len(raw) % 4) % 4)
            payload = json.loads(base64.b64decode(raw + pad))
    except Exception:
        return payment_required(path, price, description, query_params, reason="malformed_payment")

    verify = _facilitator("/verify", payload, requirements)
    if not verify.get("isValid"):
        # some facilitators return success bool
        if not verify.get("success"):
            return payment_required(
                path,
                price,
                description,
                query_params,
                reason=f"invalid_payment:{verify.get('invalidReason') or verify.get('errorReason') or 'unverified'}",
            )
    settle = _facilitator("/settle", payload, requirements)
    if settle.get("success") is False and not settle.get("transaction"):
        # allow verify-only facilitators
        if not verify.get("isValid") and not verify.get("success"):
            return payment_required(path, price, description, query_params, reason="settlement_failed")
    return None


# ---------------------------------------------------------------------------
# Discovery / free surfaces
# ---------------------------------------------------------------------------
def _path_payment_info(price: str) -> dict:
    units = _usdc_units(price) if float(price) > 0 else "0"
    return {
        "method": "x402",
        "scheme": "exact",
        "network": NETWORK,
        "asset": USDC,
        "currency": "USDC",
        "amount": price,
        "amountUnits": units,
        "payTo": PAY_TO,
        "facilitator": FACILITATOR,
        "paymentHeader": "X-PAYMENT",
        "protocols": ["x402"],
        "price": {"amount": price, "currency": "USD", "mode": "fixed"},
        "settlement": "facilitator",
    }


def _openapi_doc() -> dict:
    def paid_get(summary: str, price: str, params: list | None = None) -> dict:
        op: dict[str, Any] = {
            "summary": summary,
            "description": f"{summary}. Pay {price} USDC on Base via x402, then retry with X-PAYMENT.",
            "parameters": params or [],
            "responses": {
                "200": {"description": "OK"},
                "402": {"description": "Payment required (x402 challenge)"},
            },
        }
        if float(price) > 0:
            op["x-payment-info"] = _path_payment_info(price)
        else:
            op["security"] = []
        return {"get": op}

    paths = {
        "/health": {
            "get": {
                "summary": "Health",
                "security": [],
                "responses": {"200": {"description": "OK"}},
            }
        },
        "/x402/rwa-assets": paid_get(
            "Scan RWA universe (free lead-gen)",
            "0.00",
            [
                {"name": "limit", "in": "query", "required": False, "schema": {"type": "integer", "default": 10}},
                {"name": "asset_class", "in": "query", "required": False, "schema": {"type": "string"}},
            ],
        ),
        "/x402/rwa-valuation": paid_get(
            "RWA valuation / NAV composite",
            PRICES["rwa-valuation"],
            [
                {"name": "asset_id", "in": "query", "required": True, "schema": {"type": "string", "example": "rwa-000001"}},
                {"name": "days", "in": "query", "required": False, "schema": {"type": "integer", "default": 90}},
            ],
        ),
        "/x402/proof-of-reserves": paid_get(
            "Proof-of-reserves attestation view",
            PRICES["proof-of-reserves"],
            [{"name": "asset_id", "in": "query", "required": False, "schema": {"type": "string"}}],
        ),
        "/x402/rwa-intelligence": paid_get(
            "Full RWA intelligence bundle",
            PRICES["rwa-intelligence"],
            [{"name": "asset_id", "in": "query", "required": False, "schema": {"type": "string", "example": "rwa-000002"}}],
        ),
        "/x402/rwa-aggregates": paid_get(
            "Aggregate RWA market snapshot",
            PRICES["rwa-aggregates"],
            [],
        ),
        "/x402/rwa-risk": paid_get(
            "RWA risk scorecard",
            PRICES["rwa-risk"],
            [
                {"name": "min_score", "in": "query", "required": False, "schema": {"type": "integer"}},
                {"name": "max_score", "in": "query", "required": False, "schema": {"type": "integer"}},
            ],
        ),
    }
    return {
        "openapi": "3.1.0",
        "info": {
            "title": APP_NAME,
            "version": VERSION,
            "description": (
                "Pay-per-call RWA intelligence for agents. Free /x402/rwa-assets lead-gen; "
                "premium valuation / PoR / intelligence / aggregates settle in USDC on Base via x402. "
                "Hyphen routes only."
            ),
            "contact": {
                "name": "ScriptMasterLabs",
                "email": "hello@scriptmasterlabs.com",
                "url": "https://www.scriptmasterlabs.com",
            },
        },
        "servers": [{"url": BASE_URL}],
        "paths": paths,
        "x-service-info": {
            "payment": {
                "protocol": "x402",
                "rails": [
                    {
                        "id": "base-usdc",
                        "scheme": "exact",
                        "network": NETWORK,
                        "asset": USDC,
                        "assetSymbol": "USDC",
                        "payTo": PAY_TO,
                        "paymentHeader": "X-PAYMENT",
                        "facilitator": FACILITATOR,
                        "settlement": "facilitator",
                    }
                ],
            }
        },
    }


@app.get("/")
async def root():
    return {
        "service": APP_NAME,
        "status": "ok",
        "version": VERSION,
        "description": "Real-World Assets oracle for institutional agents",
        "endpoints": {
            "free": [
                "/x402/rwa-assets — scan and filter RWA universe",
                "/health — service status",
                "/.well-known/x402 — OpenAPI discovery",
            ],
            "premium": [
                f"/x402/rwa-valuation — {PRICES['rwa-valuation']} USDC",
                f"/x402/proof-of-reserves — {PRICES['proof-of-reserves']} USDC",
                f"/x402/rwa-intelligence — {PRICES['rwa-intelligence']} USDC",
                f"/x402/rwa-aggregates — {PRICES['rwa-aggregates']} USDC",
                f"/x402/rwa-risk — {PRICES['rwa-risk']} USDC",
            ],
        },
        "x402": {
            "network": NETWORK,
            "payTo": PAY_TO,
            "asset": USDC,
            "paymentHeader": "X-PAYMENT",
        },
        "disclaimer": "Informational composite — not audited NAV, not investment advice.",
        "sibling_catalog": "https://acp-x402-scriptmasterlabs.onrender.com/.well-known/x402",
        "acp_wedge": {"agent": "scriptmasterlabs", "rwa_intelligence": 0.03, "gas_tracker": 0.01},
    }


@app.get("/health")
async def health():
    return {
        "service": APP_NAME,
        "status": "ok",
        "timestamp": _iso(),
        "version": VERSION,
        "x402_enabled": True,
        "payTo": PAY_TO,
        "network": NETWORK,
    }


@app.get("/.well-known/x402")
@app.get("/openapi.json")
@app.get("/x402/openapi.json")
async def discovery():
    return _openapi_doc()


@app.get("/favicon.ico")
async def favicon():
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
        '<rect width="64" height="64" rx="12" fill="#0b0b10"/>'
        '<text x="50%" y="54%" text-anchor="middle" font-size="28" '
        'font-family="monospace" fill="#39FF14">R</text></svg>'
    )
    return Response(content=svg, media_type="image/svg+xml")


# ---------------------------------------------------------------------------
# Business endpoints
# ---------------------------------------------------------------------------
@app.get("/x402/rwa-assets")
async def rwa_assets(
    limit: int = Query(10, ge=1, le=100),
    asset_class: Optional[str] = Query(None),
):
    rows = _ASSETS
    if asset_class:
        rows = [a for a in rows if a["asset_class"] == asset_class]
    out = []
    for a in rows[:limit]:
        out.append(
            {
                "asset_id": a["asset_id"],
                "ticker": a["ticker"],
                "name": a["name"],
                "asset_class": a["asset_class"],
                "current_value_usd": a["current_value_usd"],
                "daily_volume": a["daily_volume"],
                "risk_score": a["risk_score"],
            }
        )
    return {
        "timestamp": _iso(),
        "count": len(out),
        "assets": out,
        "note": "Free lead-gen scan. Premium: /x402/rwa-valuation, /x402/proof-of-reserves, /x402/rwa-intelligence",
        "disclaimer": "Informational — not audited NAV.",
    }


@app.get("/x402/rwa-valuation")
async def rwa_valuation(
    request: Request,
    asset_id: str = Query(..., example="rwa-000001"),
    days: int = Query(90, ge=1, le=365),
):
    gate = require_payment(
        request,
        "/x402/rwa-valuation",
        PRICES["rwa-valuation"],
        f"ScriptMasterLabs RWA valuation. Pay {PRICES['rwa-valuation']} USDC on Base via x402 (X-PAYMENT), then retry.",
        {"asset_id": {"type": "string", "example": "rwa-000001"}, "days": {"type": "integer", "example": 90, "default": 90}},
    )
    if gate is not None:
        return gate
    asset = _get_asset(asset_id)
    if not asset:
        return JSONResponse({"error": "asset_not_found", "asset_id": asset_id}, status_code=404)
    history = []
    base = float(asset["current_value_usd"])
    for i in range(min(days, 90)):
        ts = _now() - timedelta(days=days - i)
        history.append({"timestamp": _iso(ts), "nav_usd": round(base * (1 + i * 0.0001), 2)})
    return {
        "timestamp": _iso(),
        "endpoint": "/x402/rwa-valuation",
        "asset_id": asset["asset_id"],
        "ticker": asset["ticker"],
        "name": asset["name"],
        "current_nav_usd": asset["current_value_usd"],
        "history_points": len(history),
        "history": history[-10:],  # trim payload
        "cost_usdc": float(PRICES["rwa-valuation"]),
        "disclaimer": "Informational composite — not audited NAV.",
    }


@app.get("/x402/proof-of-reserves")
async def proof_of_reserves(
    request: Request,
    asset_id: Optional[str] = Query(None),
):
    gate = require_payment(
        request,
        "/x402/proof-of-reserves",
        PRICES["proof-of-reserves"],
        f"ScriptMasterLabs RWA proof-of-reserves. Pay {PRICES['proof-of-reserves']} USDC on Base via x402 (X-PAYMENT), then retry.",
        {"asset_id": {"type": "string", "example": "rwa-000001"}},
    )
    if gate is not None:
        return gate
    if asset_id:
        asset = _get_asset(asset_id)
        if not asset:
            return JSONResponse({"error": "asset_not_found", "asset_id": asset_id}, status_code=404)
        return {
            "timestamp": _iso(),
            "endpoint": "/x402/proof-of-reserves",
            "asset_id": asset["asset_id"],
            "por_hash": asset["por_hash"],
            "method": "sha256_demo_attestation",
            "cost_usdc": float(PRICES["proof-of-reserves"]),
            "disclaimer": "Demo attestation hash — not a live custodian PoR audit.",
        }
    agg = hashlib.sha256(
        json.dumps({a["asset_id"]: a["por_hash"] for a in _ASSETS}, sort_keys=True).encode()
    ).hexdigest()
    return {
        "timestamp": _iso(),
        "endpoint": "/x402/proof-of-reserves",
        "total_assets": len(_ASSETS),
        "aggregate_hash": agg,
        "assets": [{"asset_id": a["asset_id"], "por_hash": a["por_hash"]} for a in _ASSETS],
        "cost_usdc": float(PRICES["proof-of-reserves"]),
        "disclaimer": "Demo attestation hash — not a live custodian PoR audit.",
    }


@app.get("/x402/rwa-intelligence")
async def rwa_intelligence(
    request: Request,
    asset_id: Optional[str] = Query(None),
):
    gate = require_payment(
        request,
        "/x402/rwa-intelligence",
        PRICES["rwa-intelligence"],
        f"ScriptMasterLabs RWA intelligence. Pay {PRICES['rwa-intelligence']} USDC on Base via x402 (X-PAYMENT), then retry.",
        {"asset_id": {"type": "string", "example": "rwa-000002"}},
    )
    if gate is not None:
        return gate
    if asset_id:
        asset = _get_asset(asset_id)
        if not asset:
            return JSONResponse({"error": "asset_not_found", "asset_id": asset_id}, status_code=404)
        return {
            "timestamp": _iso(),
            "endpoint": "/x402/rwa-intelligence",
            "asset": asset,
            "signals": {
                "liquidity": "high" if asset["daily_volume"] > 1_000_000 else "medium",
                "risk_band": "low" if asset["risk_score"] < 25 else "medium" if asset["risk_score"] < 40 else "elevated",
            },
            "cost_usdc": float(PRICES["rwa-intelligence"]),
            "acp_alt": "scriptmasterlabs rwa_intelligence @ $0.03",
            "disclaimer": "Informational — not investment advice.",
        }
    return {
        "timestamp": _iso(),
        "endpoint": "/x402/rwa-intelligence",
        "universe_count": len(_ASSETS),
        "top": sorted(_ASSETS, key=lambda a: -a["current_value_usd"])[:5],
        "cost_usdc": float(PRICES["rwa-intelligence"]),
        "disclaimer": "Informational — not investment advice.",
    }


@app.get("/x402/rwa-aggregates")
async def rwa_aggregates(request: Request):
    gate = require_payment(
        request,
        "/x402/rwa-aggregates",
        PRICES["rwa-aggregates"],
        f"ScriptMasterLabs RWA aggregates. Pay {PRICES['rwa-aggregates']} USDC on Base via x402 (X-PAYMENT), then retry.",
        {},
    )
    if gate is not None:
        return gate
    by_class: dict[str, dict] = {}
    for a in _ASSETS:
        c = a["asset_class"]
        by_class.setdefault(c, {"count": 0, "total_value_usd": 0})
        by_class[c]["count"] += 1
        by_class[c]["total_value_usd"] += a["current_value_usd"]
    return {
        "timestamp": _iso(),
        "endpoint": "/x402/rwa-aggregates",
        "total_assets": len(_ASSETS),
        "total_value_usd": sum(a["current_value_usd"] for a in _ASSETS),
        "avg_risk_score": round(sum(a["risk_score"] for a in _ASSETS) / len(_ASSETS), 2),
        "by_class": by_class,
        "cost_usdc": float(PRICES["rwa-aggregates"]),
        "disclaimer": "Informational aggregate — not AUM attestation.",
    }


@app.get("/x402/rwa-risk")
async def rwa_risk(
    request: Request,
    min_score: Optional[int] = Query(None),
    max_score: Optional[int] = Query(None),
):
    gate = require_payment(
        request,
        "/x402/rwa-risk",
        PRICES["rwa-risk"],
        f"ScriptMasterLabs RWA risk scorecard. Pay {PRICES['rwa-risk']} USDC on Base via x402 (X-PAYMENT), then retry.",
        {
            "min_score": {"type": "integer", "example": 0},
            "max_score": {"type": "integer", "example": 40},
        },
    )
    if gate is not None:
        return gate
    rows = _ASSETS
    if min_score is not None:
        rows = [a for a in rows if a["risk_score"] >= min_score]
    if max_score is not None:
        rows = [a for a in rows if a["risk_score"] <= max_score]
    return {
        "timestamp": _iso(),
        "endpoint": "/x402/rwa-risk",
        "count": len(rows),
        "assets": [
            {"asset_id": a["asset_id"], "ticker": a["ticker"], "risk_score": a["risk_score"], "class": a["asset_class"]}
            for a in rows
        ],
        "cost_usdc": float(PRICES["rwa-risk"]),
    }


@app.exception_handler(404)
async def not_found(request: Request, exc):  # type: ignore[no-untyped-def]
    return JSONResponse({"error": "ENDPOINT_NOT_FOUND", "path": str(request.url.path)}, status_code=404)


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8080"))
    uvicorn.run(app, host="0.0.0.0", port=port)
