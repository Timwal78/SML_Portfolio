"""Unit tests for Agent 20 — ShadowFlowHunter."""

import pandas as pd
import pytest

from src.agents.agent_20_shadow_flow_hunter import ShadowFlowHunter


def test_metadata_matches_spec():
    agent = ShadowFlowHunter()
    assert agent.metadata.agent_id == 20
    assert agent.metadata.name == "ShadowFlowHunter"
    assert agent.metadata.factors == ['ftd_zscore', 'etf_basket_divergence', 'dark_pool_pct', 'synthetic_short_score', 'short_interest_divergence']
    assert agent.metadata.long_only is True


def test_generate_signal_not_yet_implemented():
    agent = ShadowFlowHunter()
    with pytest.raises(NotImplementedError):
        agent.generate_signal(pd.DataFrame())


@pytest.mark.skip(reason="Implement once generate_signal is built (Phase 1/2)")
def test_signal_values_are_within_allowed_range():
    agent = ShadowFlowHunter()
    signal = agent.generate_signal(pd.DataFrame())
    agent.validate_output(signal)
