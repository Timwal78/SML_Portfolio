"""SML RWA API — Flask/WSGI, real x402 v2 (works with gunicorn gthread).

Render logs show worker=gthread — so this must be WSGI, not ASGI-only.
Free: GET /x402/rwa-assets
Paid: valuation / proof-of-reserves / intelligence / aggregates / risk
Discovery: /.well-known/x402 OpenAPI 3.1
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

from flask import Flask, Response, jsonify, request

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("sml-rwa-api")

APP_NAME = "SML RWA Intelligence Suite"
VERSION = "1.1.2"
BASE_URL = os.getenv("PUBLIC_BASE_URL", "https://sml-rwa-api.onrender.com").rstrip("/")
NETWORK = os.getenv("X402_NETWORK", "base")
PAY_TO = os.getenv("X402_PAY_TO", "0x72330994f379a71542e7bd5a4cf99a9d9743f4aa")
USDC = os.getenv("X402_USDC", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")
FACILITATOR = os.getenv("X402_FACILITATOR", "https://x402.org/facilitator").rstrip("/")
MAX_TIMEOUT = int(os.getenv("X402_MAX_TIMEOUT", "300"))
X402_VERSION = 2
DEPLOY_STAMP = "2026-07-23T00:40Z-flask-real-x402"

PRICES = {
    "rwa-valuation": "0.15",
    "proof-of-reserves": "0.20",
    "rwa-intelligence": "0.20",
    "rwa-aggregates": "0.25",
    "rwa-risk": "0.10",
}

app = Flask(__name__)

_ASSETS: list[dict[str, Any]] = [
    {
        "asset_id": "rwa-000001",
        "ticker": "SHV",
        "name": "US Treasury Bond ETF",
        "asset_class": "fixed_income",
        "current_value_usd": 45_000_000,
        "daily_volume": 2_500_000,
        "risk_score": 15,
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
        "por_hash": hashlib.sha256(b"rwa-000005-por-v1").hexdigest(),
    },
]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: Optional[datetime] = None) -> str:
    return (dt or _now()).isoformat()


def _units(price: str) -> str:
    return str(int(round(float(price) * 1_000_000)))


def _get_asset(asset_id: str) -> Optional[dict]:
    for a in _ASSETS:
        if a["asset_id"] == asset_id or a.get("ticker", "").upper() == asset_id.upper():
            return a
    return None


def _bazaar(query_params: Optional[dict] = None) -> dict:
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
            else:
                flat[k] = ""
        else:
            flat[k] = "" if v is None else v
            schema_props[k] = {"type": "string"}
    return {
        "bazaar": {
            "discoverable": True,
            "info": {
                "input": {"type": "http", "method": "GET", "queryParams": flat},
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
    u = _units(price)
    return {
        "scheme": "exact",
        "network": NETWORK,
        "amount": u,
        "maxAmountRequired": u,
        "asset": USDC,
        "payTo": PAY_TO,
        "maxTimeoutSeconds": MAX_TIMEOUT,
        "resource": resource,
        "description": description,
        "mimeType": "application/json",
        "extra": {"name": "USD Coin", "version": "2"},
    }


def payment_required(path: str, price: str, description: str, query_params: Optional[dict] = None, reason: str = "payment_required") -> Response:
    resource = f"{BASE_URL}{path}"
    body = {
        "x402Version": X402_VERSION,
        "error": reason,
        "resource": {"url": resource, "description": description, "mimeType": "application/json"},
        "accepts": [_accept(resource, price, description)],
        "extensions": _bazaar(query_params),
    }
    header402 = base64.b64encode(json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode()).decode("ascii")
    resp = jsonify(body)
    resp.status_code = 402
    resp.headers["Content-Type"] = "application/json; charset=utf-8"
    resp.headers["PAYMENT-REQUIRED"] = header402
    resp.headers["X-PAYMENT-REQUIRED"] = header402
    resp.headers["Access-Control-Expose-Headers"] = "PAYMENT-REQUIRED, X-PAYMENT-REQUIRED, X-PAYMENT-RESPONSE"
    resp.headers["Access-Control-Allow-Origin"] = "*"
    return resp


def _payment_header() -> Optional[str]:
    return request.headers.get("X-PAYMENT") or request.headers.get("x-payment") or request.headers.get("PAYMENT-SIGNATURE")


def _facilitator(path: str, payload: dict, requirements: dict) -> dict:
    url = f"{FACILITATOR}{path}"
    data = json.dumps({"x402Version": X402_VERSION, "paymentPayload": payload, "paymentRequirements": requirements}).encode()
    req = urllib.request.Request(url, data=data, method="POST", headers={"Content-Type": "application/json", "User-Agent": "sml-rwa-api/1.1"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode())
        except Exception:
            return {"isValid": False, "invalidReason": f"http_{e.code}"}
    except Exception as e:
        return {"isValid": False, "invalidReason": str(e)[:200]}


def require_payment(path: str, price: str, description: str, query_params: Optional[dict] = None) -> Optional[Response]:
    resource = f"{BASE_URL}{path}"
    requirements = _accept(resource, price, description)
    raw = _payment_header()
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
    if not (verify.get("isValid") or verify.get("success")):
        return payment_required(path, price, description, query_params, reason=f"invalid_payment:{verify.get('invalidReason') or verify.get('errorReason') or 'unverified'}")
    return None


def _payinfo(price: str) -> dict:
    return {
        "method": "x402",
        "scheme": "exact",
        "network": NETWORK,
        "asset": USDC,
        "currency": "USDC",
        "amount": price,
        "amountUnits": _units(price),
        "payTo": PAY_TO,
        "facilitator": FACILITATOR,
        "paymentHeader": "X-PAYMENT",
        "protocols": ["x402"],
        "price": {"amount": price, "currency": "USD", "mode": "fixed"},
        "settlement": "facilitator",
    }


def openapi_doc() -> dict:
    def paid(summary: str, price: str, params: list | None = None) -> dict:
        op: dict[str, Any] = {
            "summary": summary,
            "description": f"{summary}. Pay {price} USDC on Base via x402, retry with X-PAYMENT.",
            "parameters": params or [],
            "responses": {"200": {"description": "OK"}, "402": {"description": "Payment required"}},
            "x-payment-info": _payinfo(price),
        }
        return {"get": op}

    free = {
        "get": {
            "summary": "Scan RWA universe (free)",
            "security": [],
            "parameters": [
                {"name": "limit", "in": "query", "schema": {"type": "integer", "default": 10}},
                {"name": "asset_class", "in": "query", "schema": {"type": "string"}},
            ],
            "responses": {"200": {"description": "OK"}},
        }
    }
    return {
        "openapi": "3.1.0",
        "info": {
            "title": APP_NAME,
            "version": VERSION,
            "description": "Pay-per-call RWA intelligence. Free /x402/rwa-assets; premium valuation/PoR/intelligence settle USDC on Base via x402.",
            "contact": {"name": "ScriptMasterLabs", "email": "hello@scriptmasterlabs.com", "url": "https://www.scriptmasterlabs.com"},
        },
        "servers": [{"url": BASE_URL}],
        "paths": {
            "/health": {"get": {"summary": "Health", "security": [], "responses": {"200": {"description": "OK"}}}},
            "/x402/rwa-assets": free,
            "/x402/rwa-valuation": paid("RWA valuation", PRICES["rwa-valuation"], [{"name": "asset_id", "in": "query", "required": True, "schema": {"type": "string", "example": "rwa-000001"}}]),
            "/x402/proof-of-reserves": paid("Proof of reserves", PRICES["proof-of-reserves"], [{"name": "asset_id", "in": "query", "schema": {"type": "string"}}]),
            "/x402/rwa-intelligence": paid("RWA intelligence", PRICES["rwa-intelligence"], [{"name": "asset_id", "in": "query", "schema": {"type": "string"}}]),
            "/x402/rwa-aggregates": paid("RWA aggregates", PRICES["rwa-aggregates"]),
            "/x402/rwa-risk": paid("RWA risk", PRICES["rwa-risk"]),
        },
        "x-service-info": {
            "payment": {
                "protocol": "x402",
                "rails": [{
                    "id": "base-usdc",
                    "scheme": "exact",
                    "network": NETWORK,
                    "asset": USDC,
                    "assetSymbol": "USDC",
                    "payTo": PAY_TO,
                    "paymentHeader": "X-PAYMENT",
                    "facilitator": FACILITATOR,
                    "settlement": "facilitator",
                }],
            }
        },
    }


@app.get("/")
def root():
    return jsonify({
        "service": APP_NAME,
        "status": "ok",
        "version": VERSION,
        "deploy_stamp": DEPLOY_STAMP,
        "description": "Real-World Assets oracle for institutional agents",
        "endpoints": {
            "free": ["/x402/rwa-assets", "/health", "/.well-known/x402"],
            "premium": [
                f"/x402/rwa-valuation — {PRICES['rwa-valuation']} USDC",
                f"/x402/proof-of-reserves — {PRICES['proof-of-reserves']} USDC",
                f"/x402/rwa-intelligence — {PRICES['rwa-intelligence']} USDC",
                f"/x402/rwa-aggregates — {PRICES['rwa-aggregates']} USDC",
                f"/x402/rwa-risk — {PRICES['rwa-risk']} USDC",
            ],
        },
        "x402": {"network": NETWORK, "payTo": PAY_TO, "asset": USDC, "paymentHeader": "X-PAYMENT"},
        "disclaimer": "Informational composite — not audited NAV, not investment advice.",
        "sibling_catalog": "https://acp-x402-scriptmasterlabs.onrender.com/.well-known/x402",
        "acp_wedge": {"agent": "scriptmasterlabs", "rwa_intelligence": 0.03, "gas_tracker": 0.01},
    })


@app.get("/health")
def health():
    return jsonify({
        "service": APP_NAME,
        "status": "ok",
        "timestamp": _iso(),
        "version": VERSION,
        "deploy_stamp": DEPLOY_STAMP,
        "x402_enabled": True,
        "payTo": PAY_TO,
        "network": NETWORK,
    })


@app.get("/.well-known/x402")
@app.get("/openapi.json")
@app.get("/x402/openapi.json")
def discovery():
    return jsonify(openapi_doc())


@app.get("/favicon.ico")
def favicon():
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
        '<rect width="64" height="64" rx="12" fill="#0b0b10"/>'
        '<text x="50%" y="54%" text-anchor="middle" font-size="28" '
        'font-family="monospace" fill="#39FF14">R</text></svg>'
    )
    return Response(svg, mimetype="image/svg+xml")


@app.get("/x402/rwa-assets")
def rwa_assets():
    limit = request.args.get("limit", 10, type=int) or 10
    limit = max(1, min(limit, 100))
    asset_class = request.args.get("asset_class")
    rows = _ASSETS
    if asset_class:
        rows = [a for a in rows if a["asset_class"] == asset_class]
    out = [{
        "asset_id": a["asset_id"],
        "ticker": a["ticker"],
        "name": a["name"],
        "asset_class": a["asset_class"],
        "current_value_usd": a["current_value_usd"],
        "daily_volume": a["daily_volume"],
        "risk_score": a["risk_score"],
    } for a in rows[:limit]]
    return jsonify({
        "timestamp": _iso(),
        "count": len(out),
        "assets": out,
        "note": "Free lead-gen. Premium: valuation / proof-of-reserves / intelligence",
        "disclaimer": "Informational — not audited NAV.",
    })


@app.get("/x402/rwa-valuation")
def rwa_valuation():
    desc = f"ScriptMasterLabs RWA valuation. Pay {PRICES['rwa-valuation']} USDC on Base via x402 (X-PAYMENT), then retry."
    gate = require_payment("/x402/rwa-valuation", PRICES["rwa-valuation"], desc, {"asset_id": {"type": "string", "example": "rwa-000001"}})
    if gate is not None:
        return gate
    asset_id = request.args.get("asset_id") or ""
    asset = _get_asset(asset_id)
    if not asset:
        return jsonify({"error": "asset_not_found", "asset_id": asset_id}), 404
    days = min(max(request.args.get("days", 90, type=int) or 90, 1), 365)
    history = []
    base = float(asset["current_value_usd"])
    for i in range(min(days, 90)):
        ts = _now() - timedelta(days=days - i)
        history.append({"timestamp": _iso(ts), "nav_usd": round(base * (1 + i * 0.0001), 2)})
    return jsonify({
        "timestamp": _iso(),
        "endpoint": "/x402/rwa-valuation",
        "asset_id": asset["asset_id"],
        "ticker": asset["ticker"],
        "name": asset["name"],
        "current_nav_usd": asset["current_value_usd"],
        "history_points": len(history),
        "history": history[-10:],
        "cost_usdc": float(PRICES["rwa-valuation"]),
        "disclaimer": "Informational composite — not audited NAV.",
    })


@app.get("/x402/proof-of-reserves")
def proof_of_reserves():
    desc = f"ScriptMasterLabs RWA proof-of-reserves. Pay {PRICES['proof-of-reserves']} USDC on Base via x402 (X-PAYMENT), then retry."
    gate = require_payment("/x402/proof-of-reserves", PRICES["proof-of-reserves"], desc, {"asset_id": {"type": "string", "example": "rwa-000001"}})
    if gate is not None:
        return gate
    asset_id = request.args.get("asset_id")
    if asset_id:
        asset = _get_asset(asset_id)
        if not asset:
            return jsonify({"error": "asset_not_found", "asset_id": asset_id}), 404
        return jsonify({
            "timestamp": _iso(),
            "endpoint": "/x402/proof-of-reserves",
            "asset_id": asset["asset_id"],
            "por_hash": asset["por_hash"],
            "method": "sha256_demo_attestation",
            "cost_usdc": float(PRICES["proof-of-reserves"]),
            "disclaimer": "Demo attestation — not live custodian PoR audit.",
        })
    agg = hashlib.sha256(json.dumps({a["asset_id"]: a["por_hash"] for a in _ASSETS}, sort_keys=True).encode()).hexdigest()
    return jsonify({
        "timestamp": _iso(),
        "endpoint": "/x402/proof-of-reserves",
        "total_assets": len(_ASSETS),
        "aggregate_hash": agg,
        "assets": [{"asset_id": a["asset_id"], "por_hash": a["por_hash"]} for a in _ASSETS],
        "cost_usdc": float(PRICES["proof-of-reserves"]),
        "disclaimer": "Demo attestation — not live custodian PoR audit.",
    })


@app.get("/x402/rwa-intelligence")
def rwa_intelligence():
    desc = f"ScriptMasterLabs RWA intelligence. Pay {PRICES['rwa-intelligence']} USDC on Base via x402 (X-PAYMENT), then retry."
    gate = require_payment("/x402/rwa-intelligence", PRICES["rwa-intelligence"], desc, {"asset_id": {"type": "string", "example": "rwa-000002"}})
    if gate is not None:
        return gate
    asset_id = request.args.get("asset_id")
    if asset_id:
        asset = _get_asset(asset_id)
        if not asset:
            return jsonify({"error": "asset_not_found", "asset_id": asset_id}), 404
        return jsonify({
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
        })
    return jsonify({
        "timestamp": _iso(),
        "endpoint": "/x402/rwa-intelligence",
        "universe_count": len(_ASSETS),
        "top": sorted(_ASSETS, key=lambda a: -a["current_value_usd"])[:5],
        "cost_usdc": float(PRICES["rwa-intelligence"]),
        "disclaimer": "Informational — not investment advice.",
    })


@app.get("/x402/rwa-aggregates")
def rwa_aggregates():
    desc = f"ScriptMasterLabs RWA aggregates. Pay {PRICES['rwa-aggregates']} USDC on Base via x402 (X-PAYMENT), then retry."
    gate = require_payment("/x402/rwa-aggregates", PRICES["rwa-aggregates"], desc, {})
    if gate is not None:
        return gate
    by_class: dict[str, dict] = {}
    for a in _ASSETS:
        c = a["asset_class"]
        by_class.setdefault(c, {"count": 0, "total_value_usd": 0})
        by_class[c]["count"] += 1
        by_class[c]["total_value_usd"] += a["current_value_usd"]
    return jsonify({
        "timestamp": _iso(),
        "endpoint": "/x402/rwa-aggregates",
        "total_assets": len(_ASSETS),
        "total_value_usd": sum(a["current_value_usd"] for a in _ASSETS),
        "avg_risk_score": round(sum(a["risk_score"] for a in _ASSETS) / len(_ASSETS), 2),
        "by_class": by_class,
        "cost_usdc": float(PRICES["rwa-aggregates"]),
        "disclaimer": "Informational aggregate — not AUM attestation.",
    })


@app.get("/x402/rwa-risk")
def rwa_risk():
    desc = f"ScriptMasterLabs RWA risk. Pay {PRICES['rwa-risk']} USDC on Base via x402 (X-PAYMENT), then retry."
    gate = require_payment("/x402/rwa-risk", PRICES["rwa-risk"], desc, {"min_score": {"type": "integer"}, "max_score": {"type": "integer"}})
    if gate is not None:
        return gate
    rows = _ASSETS
    mn = request.args.get("min_score", type=int)
    mx = request.args.get("max_score", type=int)
    if mn is not None:
        rows = [a for a in rows if a["risk_score"] >= mn]
    if mx is not None:
        rows = [a for a in rows if a["risk_score"] <= mx]
    return jsonify({
        "timestamp": _iso(),
        "endpoint": "/x402/rwa-risk",
        "count": len(rows),
        "assets": [{"asset_id": a["asset_id"], "ticker": a["ticker"], "risk_score": a["risk_score"], "class": a["asset_class"]} for a in rows],
        "cost_usdc": float(PRICES["rwa-risk"]),
    })


@app.errorhandler(404)
def not_found(_e):
    return jsonify({"error": "ENDPOINT_NOT_FOUND", "path": request.path}), 404


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8080"))
    app.run(host="0.0.0.0", port=port)
