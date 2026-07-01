"""Agent 20 (ShadowFlowHunter) dedicated module — FTD, dark pool, synthetic
short, ETF basket divergence, short interest divergence. Long-only overlay,
capped at 1%, not included in the ensemble vote.
"""

from src.shadow_flow.shadow_flow_hunter import (
    TRIGGER_THRESHOLDS,
    WEIGHTS,
    ShadowFlowResult,
    evaluate,
    should_exit,
)

__all__ = ["WEIGHTS", "TRIGGER_THRESHOLDS", "ShadowFlowResult", "evaluate", "should_exit"]
