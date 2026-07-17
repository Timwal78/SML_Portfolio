#!/usr/bin/env python3
"""Production trading — LOCKED behind the PSR/DSR validation gate (spec
non-negotiables #11, #12). This script refuses to run unless the most
recent `scripts/validate.py` output shows PSR > 0.95 and Deflated SR > 0.90,
and unless a `LIVE_TRADING_CONFIRMED=yes` env var is explicitly set —
an accidental `python live_trade.py` must never place a real order.

Scaffold stub — do not implement the order-submission path until Phase 5
(PSR gate check passed) per the roadmap.
"""

from __future__ import annotations

import os


REQUIRED_CONFIRMATION_ENV_VAR = "LIVE_TRADING_CONFIRMED"


def main() -> int:
    if os.getenv(REQUIRED_CONFIRMATION_ENV_VAR) != "yes":
        raise RuntimeError(
            f"Refusing to start: set {REQUIRED_CONFIRMATION_ENV_VAR}=yes explicitly "
            "to confirm this is an intentional live-trading run. This is not a "
            "config default — it must be set at invocation time."
        )

    raise NotImplementedError(
        "scripts/live_trade.py is a scaffold stub, intentionally unimplemented "
        "until Phase 5 (PSR > 0.95 and Deflated SR > 0.90 on the 5-year backtest, "
        "verified via scripts/validate.py). Do not wire the execution path here "
        "before that gate is met."
    )


if __name__ == "__main__":
    raise SystemExit(main())
