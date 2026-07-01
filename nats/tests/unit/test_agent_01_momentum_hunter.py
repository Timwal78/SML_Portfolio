"""Unit tests for Agent 01 — MomentumHunter."""

import pandas as pd
import pytest

from src.agents.agent_01_momentum_hunter import MomentumHunter


def test_metadata_matches_spec():
    agent = MomentumHunter()
    assert agent.metadata.agent_id == 1
    assert agent.metadata.name == "MomentumHunter"
    assert agent.metadata.factors == ['mom_3d', 'mom_5d', 'mom_10d', 'mom_15d', 'mom_20d', 'acceleration']
    assert agent.metadata.long_only is False


def test_generate_signal_not_yet_implemented():
    agent = MomentumHunter()
    with pytest.raises(NotImplementedError):
        agent.generate_signal(pd.DataFrame())


@pytest.mark.skip(reason="Implement once generate_signal is built (Phase 1/2)")
def test_signal_values_are_within_allowed_range():
    agent = MomentumHunter()
    signal = agent.generate_signal(pd.DataFrame())
    agent.validate_output(signal)
