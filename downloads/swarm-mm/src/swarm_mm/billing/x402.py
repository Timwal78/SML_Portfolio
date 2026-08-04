"""x402 payment challenge helpers for swarm-mm.

Aligns with SML triple-rail conventions:
  - Base USDC (8453) payTo SML_PAYMENT_RECEIVER
  - Optional Solana USDC rail
  - Operator bypass via X-Operator-Key == SML_API_KEY (server-side only)
"""

from __future__ import annotations

import os
import secrets
from typing import Any, Optional

from fastapi import Header, HTTPException, Request
from fastapi.responses import JSONResponse

from swarm_mm.core.config import (
    BASE_CHAIN_ID,
    BASE_USDC,
    OPERATOR_HEADER,
    OPERATOR_KEY_ENV,
    SML_PAYMENT_RECEIVER,
    SOLANA_CAIP2,
    SOLANA_PAYMENT_RECEIVER,
    SOLANA_USDC_MINT,
)


def get_pay_to() -> str:
    return os.environ.get("SML_PAYMENT_RECEIVER", SML_PAYMENT_RECEIVER)


def operator_authorized(
    x_operator_key: Optional[str] = None,
    x_sml_api_key: Optional[str] = None,
) -> bool:
    expected = os.environ.get(OPERATOR_KEY_ENV, "").strip()
    if not expected:
        # Dev mode: allow if no key configured AND SWARM_MM_DEV_OPEN=1
        return os.environ.get("SWARM_MM_DEV_OPEN", "1") == "1"
    got = (x_operator_key or x_sml_api_key or "").strip()
    return bool(got) and secrets.compare_digest(got, expected)


def x402_challenge(price_usd: float, resource: str, description: str = "") -> dict[str, Any]:
    pay_to = get_pay_to()
    # atomic USDC units (6 decimals)
    amount = str(int(round(price_usd * 1_000_000)))
    accepts = [
        {
            "scheme": "exact",
            "network": f"eip155:{BASE_CHAIN_ID}",
            "maxAmountRequired": amount,
            "resource": resource,
            "description": description or f"swarm-mm {resource}",
            "mimeType": "application/json",
            "payTo": pay_to,
            "maxTimeoutSeconds": 300,
            "asset": BASE_USDC,
            "extra": {"name": "USDC", "version": "2"},
        }
    ]
    sol_pay = os.environ.get("SOLANA_PAYMENT_RECEIVER", SOLANA_PAYMENT_RECEIVER)
    if sol_pay and not sol_pay.startswith("E4d3placeholder"):
        accepts.append(
            {
                "scheme": "exact",
                "network": SOLANA_CAIP2,
                "maxAmountRequired": amount,
                "resource": resource,
                "description": description or f"swarm-mm {resource}",
                "mimeType": "application/json",
                "payTo": sol_pay,
                "maxTimeoutSeconds": 300,
                "asset": SOLANA_USDC_MINT,
                "extra": {"name": "USDC", "version": "spl"},
            }
        )
    return {
        "x402Version": 1,
        "error": "Payment required",
        "accepts": accepts,
        "payToByNetwork": {
            f"eip155:{BASE_CHAIN_ID}": pay_to,
            **({SOLANA_CAIP2: sol_pay} if sol_pay and not sol_pay.startswith("E4d3placeholder") else {}),
        },
        "price_usd": price_usd,
    }


def payment_response(price_usd: float, resource: str, description: str = "") -> JSONResponse:
    body = x402_challenge(price_usd, resource, description)
    return JSONResponse(status_code=402, content=body, headers={"X-Payment-Required": "true"})


async def require_payment_or_operator(
    request: Request,
    price_usd: float,
    resource: str,
    description: str = "",
    x_operator_key: Optional[str] = None,
    x_payment: Optional[str] = None,
    x_payment_hash: Optional[str] = None,
) -> dict[str, Any]:
    """Gate a route. Free when price_usd<=0. Operator key bypasses. Else require payment proof header.

    MVP verification: presence of X-PAYMENT or X-Payment-Hash is accepted when
    SWARM_MM_PAYMENT_VERIFY=soft (default). Set SWARM_MM_PAYMENT_VERIFY=strict
    to reject until a full chain verifier is wired (reuse mcp-x402 verify).

    Call from route handlers with header values already extracted — do not rely on
    FastAPI Header() defaults here (this is invoked as a plain async function).
    """
    if price_usd <= 0:
        return {"paid": False, "free": True, "price_usd": 0.0}

    # Also accept headers directly off the request if caller omitted kwargs
    if x_operator_key is None:
        x_operator_key = request.headers.get("X-Operator-Key") or request.headers.get("x-operator-key")
    if x_payment is None:
        x_payment = request.headers.get("X-PAYMENT") or request.headers.get("x-payment")
    if x_payment_hash is None:
        x_payment_hash = request.headers.get("X-Payment-Hash") or request.headers.get("x-payment-hash")

    if operator_authorized(x_operator_key):
        return {"paid": True, "via": "operator", "price_usd": price_usd}

    mode = os.environ.get("SWARM_MM_PAYMENT_VERIFY", "soft").lower()
    proof = (x_payment or x_payment_hash or "").strip()
    if proof:
        if mode == "strict":
            # Placeholder for full verifier hook
            raise HTTPException(
                status_code=501,
                detail="strict payment verify not wired in swarm-mm MVP — use operator key or soft mode",
            )
        return {"paid": True, "via": "x402_proof_soft", "price_usd": price_usd, "proof_prefix": proof[:18]}

    # Raise 402 via HTTPException-like response — caller should return payment_response
    raise PaymentRequired(price_usd=price_usd, resource=resource, description=description)


class PaymentRequired(Exception):
    def __init__(self, price_usd: float, resource: str, description: str = "") -> None:
        self.price_usd = price_usd
        self.resource = resource
        self.description = description
        super().__init__("payment_required")


def well_known_resources() -> dict[str, Any]:
    """/.well-known/x402 resources catalog."""
    pay_to = get_pay_to()
    resources = [
        {
            "resource": "/v1/signal/levels",
            "description": "Signal swarm limit-order levels",
            "price_usd": 0.001,
            "variant": "A",
        },
        {
            "resource": "/v1/signal/venue-map",
            "description": "Venue allocation map",
            "price_usd": 0.001,
            "variant": "A",
        },
        {
            "resource": "/v1/signal/rebate-tracker",
            "description": "Maker rebate estimate",
            "price_usd": 0.001,
            "variant": "A",
        },
        {
            "resource": "/v1/sim/join",
            "description": "Join simulated swarm (free)",
            "price_usd": 0.0,
            "variant": "D",
        },
        {
            "resource": "/v1/sim/trade",
            "description": "Paper trade (free)",
            "price_usd": 0.0,
            "variant": "D",
        },
        {
            "resource": "/v1/sim/leaderboard",
            "description": "Sim leaderboard (free)",
            "price_usd": 0.0,
            "variant": "D",
        },
        {
            "resource": "/v1/sim/premium",
            "description": "Premium sim analytics subscription",
            "price_usd": 9.0,
            "variant": "D",
            "interval": "month",
        },
        {
            "resource": "/v1/b2b/optimize",
            "description": "B2B optimize pass",
            "price_usd": 0.05,
            "variant": "C",
        },
        {
            "resource": "/v1/b2b/report",
            "description": "B2B performance report",
            "price_usd": 0.10,
            "variant": "C",
        },
        {
            "resource": "/v1/crypto/positions",
            "description": "Crypto swarm positions",
            "price_usd": 0.001,
            "variant": "B",
        },
    ]
    return {
        "x402Version": 1,
        "product": "swarm-mm",
        "company": "Script Master Labs",
        "payTo": pay_to,
        "networks": [f"eip155:{BASE_CHAIN_ID}"],
        "payToByNetwork": {f"eip155:{BASE_CHAIN_ID}": pay_to},
        "resources": resources,
        "acceptsAsset": {"eip155:8453": BASE_USDC},
    }
