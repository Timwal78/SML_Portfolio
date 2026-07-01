"""NATS v2.0 alpha factor library — 50+ factors across 15 categories.

RULE (spec UPGRADE 2 — anti-lookahead): every factor function in this
package returns a `.shift(1)`'d Series. A factor value at index `t` must
only use information available at or before `t-1`. Run
`python -m src.factors.lint_check` (or `pytest tests/unit/test_factors_lint.py`)
before any factor is wired into an agent or the ensemble.
"""

from src.factors import (
    cross_asset,
    dark_pool,
    dispersion,
    earnings,
    macro,
    market_structure,
    mean_reversion,
    microstructure,
    momentum,
    options,
    seasonality,
    sentiment,
    volatility,
    volume,
    credit,
)

__all__ = [
    "momentum",
    "volatility",
    "mean_reversion",
    "volume",
    "microstructure",
    "cross_asset",
    "dispersion",
    "sentiment",
    "seasonality",
    "macro",
    "earnings",
    "options",
    "dark_pool",
    "market_structure",
    "credit",
]
