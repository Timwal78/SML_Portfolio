"""Shared constants, types, and config for all swarm variants."""

from __future__ import annotations

import os
from enum import Enum
from typing import Literal

# ── Identity / payments (SML rails) ──────────────────────────────────────────
SML_PAYMENT_RECEIVER = os.environ.get(
    "SML_PAYMENT_RECEIVER",
    "0x72330994f379a71542e7bd5a4cf99a9d9743f4aa",
)
SOLANA_PAYMENT_RECEIVER = os.environ.get(
    "SOLANA_PAYMENT_RECEIVER",
    "E4d3placeholder_replace_with_live_sol_payto",
)
BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
BASE_CHAIN_ID = 8453
SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
SOLANA_CAIP2 = "solana:5eykt4UsbcABq2hH5nAEPytZ1Z1t2uB6u2uB6u2uB6"  # mainnet CAIP-2 style

OPERATOR_KEY_ENV = "SML_API_KEY"
OPERATOR_HEADER = "X-Operator-Key"

# ── Pricing (x402) ───────────────────────────────────────────────────────────
PRICE_SIGNAL_SUB_USD = 19.0          # Variant A monthly
PRICE_SIM_PREMIUM_USD = 9.0          # Variant D premium analytics
PRICE_B2B_PLATFORM_USD = 5000.0      # Variant C monthly seat
PRICE_B2B_REBATE_SHARE = 0.02        # 2% of incremental rebate improvement
PRICE_CRYPTO_REBATE_SHARE = 0.005     # 0.5% of gross maker rebate
PRICE_LEVELS_CALL_USD = 0.001        # hot call floor (snacks)
PRICE_VENUE_MAP_USD = 0.001
PRICE_REBATE_TRACKER_USD = 0.001
PRICE_B2B_OPTIMIZE_USD = 0.05
PRICE_B2B_REPORT_USD = 0.10

# ── Engine defaults ──────────────────────────────────────────────────────────
DEFAULT_CONFIDENCE = 0.75
DEFAULT_SWARM_DEPTH = 5              # price levels per side
MAX_SWARM_PARTICIPANTS = 50_000
SIM_BALANCES = (10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000)
DEFAULT_SIM_BALANCE = 100_000
MAKER_REBATE_BPS_DEFAULT = 0.20      # 0.20 bps illustrative maker rebate
SPREAD_CAPTURE_BPS_DEFAULT = 1.5
VENUE_WEIGHTS_DEFAULT = {
    "IEX": 0.60,
    "MEMX": 0.25,
    "NYSE": 0.10,
    "NASDAQ": 0.05,
}
CRYPTO_DEX_WEIGHTS_DEFAULT = {
    "hyperliquid": 0.40,
    "dydx": 0.25,
    "gmx": 0.20,
    "drift": 0.15,
}

DISCLAIMER = (
    "Educational / research signals only. Not investment advice. "
    "Not a broker-dealer, ATS, or investment adviser. "
    "Users place orders through their own licensed brokerage accounts. "
    "Past simulated performance is not indicative of future results. "
    "Script Master Labs — SDVOSB."
)


class Variant(str, Enum):
    A_SIGNAL = "A"
    B_CRYPTO = "B"
    C_B2B = "C"
    D_SIM = "D"


class Side(str, Enum):
    BUY = "buy"
    SELL = "sell"
    BOTH = "both"


class OrderStatus(str, Enum):
    RESTING = "resting"
    PARTIAL = "partial"
    FILLED = "filled"
    CANCELLED = "cancelled"
    REJECTED = "rejected"
    SIMULATED = "simulated"


SideLit = Literal["buy", "sell", "both"]
VariantLit = Literal["A", "B", "C", "D"]
