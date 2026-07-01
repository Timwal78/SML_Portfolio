"""Unit tests for Agent 13 — EarningsEdge."""

import pandas as pd
import pytest

from src.agents.agent_13_earnings_edge import EarningsEdge


def test_metadata_matches_spec():
    agent = EarningsEdge()
    assert agent.metadata.agent_id == 13
    assert agent.metadata.name == "EarningsEdge"
    assert agent.metadata.factors == ['eps_surprise_magnitude', 'eps_surprise_direction', 'analyst_revision_velocity']
    assert agent.metadata.long_only is False


def test_generate_signal_not_yet_implemented():
    agent = EarningsEdge()
    with pytest.raises(NotImplementedError):
        agent.generate_signal(pd.DataFrame())


@pytest.mark.skip(reason="Implement once generate_signal is built (Phase 1/2)")
def test_signal_values_are_within_allowed_range():
    agent = EarningsEdge()
    signal = agent.generate_signal(pd.DataFrame())
    agent.validate_output(signal)
