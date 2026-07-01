"""Unit tests for Agent 10 — TrendFollower."""

import pandas as pd
import pytest

from src.agents.agent_10_trend_follower import TrendFollower


def test_metadata_matches_spec():
    agent = TrendFollower()
    assert agent.metadata.agent_id == 10
    assert agent.metadata.name == "TrendFollower"
    assert agent.metadata.factors == ['mom_5d', 'mom_20d', 'atr_stop', 'kelly_fraction']
    assert agent.metadata.long_only is False


def test_generate_signal_not_yet_implemented():
    agent = TrendFollower()
    with pytest.raises(NotImplementedError):
        agent.generate_signal(pd.DataFrame())


@pytest.mark.skip(reason="Implement once generate_signal is built (Phase 1/2)")
def test_signal_values_are_within_allowed_range():
    agent = TrendFollower()
    signal = agent.generate_signal(pd.DataFrame())
    agent.validate_output(signal)
