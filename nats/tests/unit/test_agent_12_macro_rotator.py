"""Unit tests for Agent 12 — MacroRotator."""

import pandas as pd
import pytest

from src.agents.agent_12_macro_rotator import MacroRotator


def test_metadata_matches_spec():
    agent = MacroRotator()
    assert agent.metadata.agent_id == 12
    assert agent.metadata.name == "MacroRotator"
    assert agent.metadata.factors == ['yield_curve_slope', 'fed_funds_futures', 'inflation_breakevens', 'regime_state']
    assert agent.metadata.long_only is False


def test_generate_signal_not_yet_implemented():
    agent = MacroRotator()
    with pytest.raises(NotImplementedError):
        agent.generate_signal(pd.DataFrame())


@pytest.mark.skip(reason="Implement once generate_signal is built (Phase 1/2)")
def test_signal_values_are_within_allowed_range():
    agent = MacroRotator()
    signal = agent.generate_signal(pd.DataFrame())
    agent.validate_output(signal)
