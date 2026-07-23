"""SML RWA Intelligence Suite — Flask/WSGI + real live feeds + x402 v2.

NO demo/synthetic asset catalog. Data path:
  curated registry (stable IDs) + DefiLlama TVL + CoinGecko markets
  + recomputable SHA-256 source-integrity proofs.

Worker: gunicorn gthread (Render).
"""
from __future__ import annotations

import base64
import json
import logging
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Optional

from flask import Flask, Response, jsonify, request

import rwa_engine as eng

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("sml-rwa-api")

APP_NAME = "SML RWA Intelligence Suite"
VERSION = "2.0.0"
BASE_URL = os.getenv("PUBLIC_BASE_URL", "https://sml-rwa-api.onrender.com").rstrip("/")
NETWORK = os.getenv("X402_NETWORK", "base")
PAY_TO = os.getenv("X402_PAY_TO", "0x72330994f379a71542e7bd5a4cf99a9d9743f4aa")
USDC = os.getenv("X402_USDC", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")
FACILITATOR = os.getenv("X402_FACILITATOR", "https://x402.org/facilitator").rstrip("/")
MAX_TIMEOUT = int(os.getenv("X402_MAX_TIMEOUT", "300"))
X402_VERSION = 2
DEPLOY_STAMP = "2026-07-23T16:10Z-live-engine-v2-no-demo"

PRICES = {
    "rwa-valuation": "0.15",
    "proof-of-reserves": "0.20",
    "rwa-intelligence": "0.20",
    "rwa-aggregates": "0.25",
    "rwa-risk": "0.10",
}

app = Flask(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _units(price: str) -> str:
    return str(int(round(float(price) * 1_000_000)))


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


def payment_required(
    path: str,
    price: str,
    description: str,
    query_params: Optional[dict] = None,
    reason: str = "payment_required",
) -> Response:
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
    data = json.dumps(
        {"x402Version": X402_VERSION, "paymentPayload": payload, "paymentRequirements": requirements}
    ).encode()
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json", "User-Agent": f"sml-rwa-api/{VERSION}"},
    )
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


def require_payment(
    path: str,
    price: str,
    description: str,
    query_params: Optional[dict] = None,
) -> Optional[Response]:
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
        reason = f"invalid_payment:{verify.get('invalidReason') or verify.get('errorReason') or 'unverified'}"
        return payment_required(path, price, description, query_params, reason=reason)
    # settle best-effort (facilitator)
    try:
        _facilitator("/settle", payload, requirements)
    except Exception:
        logger.exception("settle failed")
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
        return {
            "get": {
                "summary": summary,
                "description": f"{summary}. Pay {price} USDC on Base via x402, retry with X-PAYMENT.",
                "parameters": params or [],
                "responses": {"200": {"description": "OK"}, "402": {"description": "Payment required"}},
                "x-payment-info": _payinfo(price),
            }
        }

    free = {
        "get": {
            "summary": "Scan live RWA universe (free)",
            "security": [],
            "parameters": [
                {"name": "limit", "in": "query", "schema": {"type": "integer", "default": 10}},
                {"name": "asset_class", "in": "query", "schema": {"type": "string"}},
                {"name": "chain", "in": "query", "schema": {"type": "string"}},
                {"name": "q", "in": "query", "schema": {"type": "string"}},
                {"name": "min_tvl_usd", "in": "query", "schema": {"type": "number"}},
                {"name": "max_risk", "in": "query", "schema": {"type": "number"}},
                {"name": "constraint", "in": "query", "schema": {"type": "string", "example": "class=tokenized_treasuries,risk<40"}},
            ],
            "responses": {"200": {"description": "OK"}},
        }
    }
    return {
        "openapi": "3.1.0",
        "info": {
            "title": APP_NAME,
            "version": VERSION,
            "description": (
                "Live RWA intelligence for agents. Free /x402/rwa-assets from DefiLlama+CoinGecko; "
                "premium valuation/PoR/intelligence settle USDC on Base via x402. No synthetic catalog."
            ),
            "contact": {
                "name": "ScriptMasterLabs",
                "email": "hello@scriptmasterlabs.com",
                "url": "https://www.scriptmasterlabs.com",
            },
        },
        "servers": [{"url": BASE_URL}],
        "paths": {
            "/health": {"get": {"summary": "Health", "security": [], "responses": {"200": {"description": "OK"}}}},
            "/x402/rwa-assets": free,
            "/x402/rwa-valuation": paid(
                "RWA valuation (live TVL/mcap + history)",
                PRICES["rwa-valuation"],
                [
                    {
                        "name": "asset_id",
                        "in": "query",
                        "required": True,
                        "schema": {"type": "string", "example": "buidl"},
                    },
                    {"name": "days", "in": "query", "schema": {"type": "integer", "default": 30}},
                ],
            ),
            "/x402/proof-of-reserves": paid(
                "Live source-integrity proof (SHA-256 recomputable)",
                PRICES["proof-of-reserves"],
                [{"name": "asset_id", "in": "query", "schema": {"type": "string", "example": "buidl"}}],
            ),
            "/x402/rwa-intelligence": paid(
                "RWA intelligence bundle",
                PRICES["rwa-intelligence"],
                [
                    {"name": "asset_id", "in": "query", "schema": {"type": "string", "example": "buidl"}},
                    {
                        "name": "action",
                        "in": "query",
                        "schema": {
                            "type": "string",
                            "enum": ["list", "valuation", "risk", "aggregates", "por"],
                        },
                    },
                    {"name": "constraint", "in": "query", "schema": {"type": "string"}},
                ],
            ),
            "/x402/rwa-aggregates": paid("RWA aggregates", PRICES["rwa-aggregates"]),
            "/x402/rwa-risk": paid(
                "RWA risk",
                PRICES["rwa-risk"],
                [{"name": "asset_id", "in": "query", "schema": {"type": "string", "example": "buidl"}}],
            ),
        },
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
            },
            "data": {
                "synthetic": False,
                "feeds": ["defillama_protocols", "coingecko_simple_price", "coingecko_market_chart"],
                "engine": "scriptmasterlabs_rwa_v2",
            },
        },
    }


def _params_from_request() -> dict[str, Any]:
    args = request.args
    out: dict[str, Any] = {}
    for k in args.keys():
        out[k] = args.get(k)
    # aliases
    if "asset_id" in out and "id" not in out:
        out["id"] = out["asset_id"]
    if "id" in out and "asset_id" not in out:
        out["asset_id"] = out["id"]
    return out


def _slim_asset(row: dict[str, Any]) -> dict[str, Any]:
    val = row.get("valuation") or {}
    risk = row.get("risk") or {}
    sig = val.get("signals") or {}
    return {
        "asset_id": row.get("id"),
        "ticker": row.get("symbol"),
        "name": row.get("name"),
        "asset_class": row.get("asset_class"),
        "issuer": row.get("issuer"),
        "chains": row.get("chains") or [],
        "contracts": row.get("contracts") or {},
        "current_value_usd": val.get("primary_value_usd"),
        "value_basis": val.get("primary_value_basis"),
        "confidence_0_to_1": val.get("confidence_0_to_1"),
        "daily_volume": sig.get("token_volume_24h_usd"),
        "token_price_usd": sig.get("token_price_usd"),
        "protocol_tvl_usd": sig.get("protocol_tvl_usd"),
        "risk_score": risk.get("risk_score"),
        "risk_band": risk.get("risk_band"),
        "source_integrity_hash": (row.get("source_integrity") or {}).get("hash"),
        "sources": row.get("sources"),
        "tags": row.get("tags") or [],
    }


@app.get("/")
def root():
    return jsonify(
        {
            "service": APP_NAME,
            "status": "ok",
            "version": VERSION,
            "deploy_stamp": DEPLOY_STAMP,
            "description": "Live Real-World Assets oracle for institutional agents (no synthetic catalog)",
            "data": {
                "synthetic": False,
                "engine": "scriptmasterlabs_rwa_v2",
                "feeds": ["defillama_protocols", "coingecko_simple_price", "coingecko_market_chart"],
            },
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
            "disclaimer": (
                "Live public-feed composites + source-integrity hashes. "
                "Not a custodian legal PoR letter. Not investment advice."
            ),
            "sibling_catalog": "https://acp-x402-scriptmasterlabs.onrender.com/.well-known/x402",
            "acp_wedge": {"agent": "scriptmasterlabs", "rwa_intelligence": 0.03, "gas_tracker": 0.01},
        }
    )


@app.get("/health")
def health():
    return jsonify(
        {
            "service": APP_NAME,
            "status": "ok",
            "timestamp": _now(),
            "version": VERSION,
            "deploy_stamp": DEPLOY_STAMP,
            "x402_enabled": True,
            "payTo": PAY_TO,
            "network": NETWORK,
            "engine": "scriptmasterlabs_rwa_v2",
            "synthetic": False,
        }
    )


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
    """Free lead-gen scan — LIVE feeds only."""
    params = _params_from_request()
    try:
        if params.get("limit") is None:
            params["limit"] = 10
        data = eng.list_assets(params)
    except Exception as e:
        logger.exception("list_assets failed")
        return jsonify({"error": "upstream_feed_error", "detail": str(e)[:200]}), 502

    assets = [_slim_asset(a) for a in (data.get("assets") or [])]
    return jsonify(
        {
            "timestamp": data.get("timestamp") or _now(),
            "count": len(assets),
            "total_primary_value_usd": data.get("total_primary_value_usd"),
            "by_asset_class_usd": data.get("by_asset_class_usd"),
            "assets": assets,
            "filters": data.get("filters"),
            "registry_size": data.get("registry_size"),
            "engine": data.get("engine") or "scriptmasterlabs_rwa_v2",
            "synthetic": False,
            "note": "Free live scan. Premium: valuation / proof-of-reserves / intelligence",
            "disclaimer": data.get("disclaimer"),
        }
    )


@app.get("/x402/rwa-valuation")
def rwa_valuation():
    desc = (
        f"ScriptMasterLabs live RWA valuation. Pay {PRICES['rwa-valuation']} USDC on Base via x402 (X-PAYMENT), then retry."
    )
    gate = require_payment(
        "/x402/rwa-valuation",
        PRICES["rwa-valuation"],
        desc,
        {"asset_id": {"type": "string", "example": "buidl"}, "days": {"type": "integer", "example": 30}},
    )
    if gate is not None:
        return gate
    params = _params_from_request()
    if not (params.get("id") or params.get("asset_id")):
        return jsonify({"error": "missing_asset_id", "hint": "Pass asset_id=buidl (or ondo, paxg, maple, ...)"}), 400
    try:
        data = eng.get_valuation_with_history(params)
    except Exception as e:
        logger.exception("valuation failed")
        return jsonify({"error": "upstream_feed_error", "detail": str(e)[:200]}), 502
    if data.get("error"):
        return jsonify(data), 404 if data.get("error") == "not_found" else 400
    asset = data.get("asset") or {}
    val = asset.get("valuation") or {}
    return jsonify(
        {
            "timestamp": data.get("timestamp") or _now(),
            "endpoint": "/x402/rwa-valuation",
            "asset_id": asset.get("id"),
            "ticker": asset.get("symbol"),
            "name": asset.get("name"),
            "asset_class": asset.get("asset_class"),
            "issuer": asset.get("issuer"),
            "current_nav_usd": val.get("primary_value_usd"),
            "value_basis": val.get("primary_value_basis"),
            "confidence_0_to_1": val.get("confidence_0_to_1"),
            "methods": val.get("methods"),
            "signals": val.get("signals"),
            "risk": asset.get("risk"),
            "source_integrity": asset.get("source_integrity"),
            "history": data.get("history"),
            "history_stats": data.get("history_stats"),
            "history_sources": data.get("history_sources"),
            "sources": asset.get("sources"),
            "synthetic": False,
            "cost_usdc": float(PRICES["rwa-valuation"]),
            "engine": data.get("engine") or "scriptmasterlabs_rwa_v2",
            "disclaimer": val.get("disclaimer")
            or "Live public-feed composite — not a custodian-audited NAV letter.",
        }
    )


@app.get("/x402/proof-of-reserves")
def proof_of_reserves():
    desc = (
        f"ScriptMasterLabs live RWA source-integrity proof. "
        f"Pay {PRICES['proof-of-reserves']} USDC on Base via x402 (X-PAYMENT), then retry."
    )
    gate = require_payment(
        "/x402/proof-of-reserves",
        PRICES["proof-of-reserves"],
        desc,
        {"asset_id": {"type": "string", "example": "buidl"}},
    )
    if gate is not None:
        return gate
    params = _params_from_request()
    try:
        data = eng.get_proof_of_reserves(params)
    except Exception as e:
        logger.exception("por failed")
        return jsonify({"error": "upstream_feed_error", "detail": str(e)[:200]}), 502
    if data.get("error"):
        return jsonify(data), 404 if data.get("error") == "not_found" else 400
    data = dict(data)
    data.update(
        {
            "endpoint": "/x402/proof-of-reserves",
            "synthetic": False,
            "cost_usdc": float(PRICES["proof-of-reserves"]),
        }
    )
    # normalize single-asset shape
    if "proof" in data:
        data["por_hash"] = (data.get("proof") or {}).get("hash")
        data["method"] = (data.get("proof") or {}).get("method")
        data["algorithm"] = (data.get("proof") or {}).get("algorithm")
        data["verifiable"] = True
    return jsonify(data)


@app.get("/x402/rwa-intelligence")
def rwa_intelligence():
    desc = (
        f"ScriptMasterLabs live RWA intelligence. "
        f"Pay {PRICES['rwa-intelligence']} USDC on Base via x402 (X-PAYMENT), then retry."
    )
    gate = require_payment(
        "/x402/rwa-intelligence",
        PRICES["rwa-intelligence"],
        desc,
        {
            "asset_id": {"type": "string", "example": "buidl"},
            "action": {"type": "string", "example": "valuation"},
        },
    )
    if gate is not None:
        return gate
    params = _params_from_request()
    action = (params.get("action") or "").strip().lower()
    # default: if asset_id present → valuation bundle; else aggregates summary + top
    if not action:
        action = "valuation" if (params.get("id") or params.get("asset_id")) else "aggregates"
        params["action"] = action
    try:
        wrapped = eng.rwa_intelligence(params)
        payload = json.loads(wrapped["result"]) if isinstance(wrapped.get("result"), str) else wrapped
    except Exception as e:
        logger.exception("intelligence failed")
        return jsonify({"error": "upstream_feed_error", "detail": str(e)[:200]}), 502
    if payload.get("error") and payload.get("error") not in ("unknown_action",):
        code = 404 if payload.get("error") == "not_found" else 400
        return jsonify(payload), code
    return jsonify(
        {
            "timestamp": _now(),
            "endpoint": "/x402/rwa-intelligence",
            "action": action,
            "data": payload,
            "synthetic": False,
            "cost_usdc": float(PRICES["rwa-intelligence"]),
            "acp_alt": "scriptmasterlabs rwa_intelligence @ $0.03",
            "engine": "scriptmasterlabs_rwa_v2",
            "disclaimer": "Live public-feed intelligence bundle. Not investment advice.",
        }
    )


@app.get("/x402/rwa-aggregates")
def rwa_aggregates():
    desc = (
        f"ScriptMasterLabs live RWA aggregates. "
        f"Pay {PRICES['rwa-aggregates']} USDC on Base via x402 (X-PAYMENT), then retry."
    )
    gate = require_payment("/x402/rwa-aggregates", PRICES["rwa-aggregates"], desc, {})
    if gate is not None:
        return gate
    params = _params_from_request()
    try:
        data = eng.aggregates(params)
    except Exception as e:
        logger.exception("aggregates failed")
        return jsonify({"error": "upstream_feed_error", "detail": str(e)[:200]}), 502
    data = dict(data)
    data.update(
        {
            "endpoint": "/x402/rwa-aggregates",
            "synthetic": False,
            "cost_usdc": float(PRICES["rwa-aggregates"]),
        }
    )
    return jsonify(data)


@app.get("/x402/rwa-risk")
def rwa_risk():
    desc = (
        f"ScriptMasterLabs live RWA risk. "
        f"Pay {PRICES['rwa-risk']} USDC on Base via x402 (X-PAYMENT), then retry."
    )
    gate = require_payment(
        "/x402/rwa-risk",
        PRICES["rwa-risk"],
        desc,
        {"asset_id": {"type": "string", "example": "buidl"}},
    )
    if gate is not None:
        return gate
    params = _params_from_request()
    if not (params.get("id") or params.get("asset_id")):
        # universe risk snapshot via aggregates top
        try:
            agg = eng.aggregates(params)
        except Exception as e:
            return jsonify({"error": "upstream_feed_error", "detail": str(e)[:200]}), 502
        return jsonify(
            {
                "timestamp": _now(),
                "endpoint": "/x402/rwa-risk",
                "mode": "universe_top",
                "top_assets": agg.get("top_assets"),
                "synthetic": False,
                "cost_usdc": float(PRICES["rwa-risk"]),
                "engine": "scriptmasterlabs_rwa_v2",
            }
        )
    try:
        data = eng.get_risk(params)
    except Exception as e:
        logger.exception("risk failed")
        return jsonify({"error": "upstream_feed_error", "detail": str(e)[:200]}), 502
    if data.get("error"):
        return jsonify(data), 404 if data.get("error") == "not_found" else 400
    data = dict(data)
    data.update(
        {
            "endpoint": "/x402/rwa-risk",
            "synthetic": False,
            "cost_usdc": float(PRICES["rwa-risk"]),
        }
    )
    return jsonify(data)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "8080")))
