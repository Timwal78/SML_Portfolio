"""Agent 20 dedicated module — ShadowFlowHunter detection model.

Implements the exact weighted-indicator rule from the spec:

    FTD_ZSCORE                  weight 0.25   trigger: > 3 sigma above 90d mean
    ETF_BASKET_DIVERGENCE       weight 0.20   trigger: > 20% above weighted holdings
    DARK_POOL_SUPPRESSION       weight 0.20   trigger: dark pool % > 60% of volume
    SYNTHETIC_SHORT_SCORE       weight 0.20   trigger: > 0.65
    SHORT_INTEREST_DIVERGENCE   weight 0.15   trigger: short interest flat/declining
                                               while price declines

Signal generation rule: require 3+ of the 5 indicators triggering
simultaneously. 1-2 = noise (signal=0). 3+ = structural anomaly (signal=+1,
contrarian long — NEVER -1). Confidence = weighted sum of triggered
indicators. This module accepts pre-computed factor values (from
factors/market_structure.py, factors/dark_pool.py, factors/options.py) —
it does not fetch data itself.
"""

from __future__ import annotations

from dataclasses import dataclass

WEIGHTS = {
    "ftd_zscore": 0.25,
    "etf_basket_divergence": 0.20,
    "dark_pool_suppression": 0.20,
    "synthetic_short_score": 0.20,
    "short_interest_divergence": 0.15,
}

TRIGGER_THRESHOLDS = {
    "ftd_zscore": 3.0,
    "etf_basket_divergence": 0.20,
    "dark_pool_suppression": 0.60,
    "synthetic_short_score": 0.65,
    "short_interest_divergence": 0.0,  # any positive divergence (see docstring) triggers
}


@dataclass
class ShadowFlowResult:
    ticker: str
    ftd_zscore: float
    etf_basket_divergence: float
    dark_pool_pct: float
    synthetic_short_score: float
    short_int_divergence: float
    indicators_triggered: int
    signal: int
    confidence: float
    squeeze_probability: float


def evaluate(
    ticker: str,
    ftd_zscore: float,
    etf_basket_divergence: float,
    dark_pool_pct: float,
    synthetic_short_score: float,
    short_int_divergence: float,
) -> ShadowFlowResult:
    triggers = {
        "ftd_zscore": ftd_zscore > TRIGGER_THRESHOLDS["ftd_zscore"],
        "etf_basket_divergence": etf_basket_divergence > TRIGGER_THRESHOLDS["etf_basket_divergence"],
        "dark_pool_suppression": dark_pool_pct > TRIGGER_THRESHOLDS["dark_pool_suppression"],
        "synthetic_short_score": synthetic_short_score > TRIGGER_THRESHOLDS["synthetic_short_score"],
        "short_interest_divergence": short_int_divergence > TRIGGER_THRESHOLDS["short_interest_divergence"],
    }
    indicators_triggered = sum(triggers.values())

    confidence = sum(WEIGHTS[name] for name, fired in triggers.items() if fired)

    signal = 1 if indicators_triggered >= 3 else 0
    # squeeze_probability is a monotone function of confidence, only meaningful
    # once signal fires — capped at 0.95 to avoid overclaiming certainty from
    # a 5-indicator heuristic model.
    squeeze_probability = min(confidence, 0.95) if signal else 0.0

    return ShadowFlowResult(
        ticker=ticker,
        ftd_zscore=ftd_zscore,
        etf_basket_divergence=etf_basket_divergence,
        dark_pool_pct=dark_pool_pct,
        synthetic_short_score=synthetic_short_score,
        short_int_divergence=short_int_divergence,
        indicators_triggered=indicators_triggered,
        signal=signal,
        confidence=confidence,
        squeeze_probability=squeeze_probability,
    )


def should_exit(
    indicators_normalized_count: int,
    unrealized_pnl_pct: float,
    profit_target: float = 0.15,
    stop_loss: float = -0.05,
) -> bool:
    """Exit rule: any 2 indicators normalize OR +15% gain OR -5% stop."""
    return (
        indicators_normalized_count >= 2
        or unrealized_pnl_pct >= profit_target
        or unrealized_pnl_pct <= stop_loss
    )
