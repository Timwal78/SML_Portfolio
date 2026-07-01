"""Unit tests for Agent 07 — SeasonalityExpert."""

import pandas as pd
import pytest

from src.agents.agent_07_seasonality_expert import SeasonalityExpert


def test_metadata_matches_spec():
    agent = SeasonalityExpert()
    assert agent.metadata.agent_id == 7
    assert agent.metadata.name == "SeasonalityExpert"
    assert agent.metadata.factors == ['day_of_week_effect', 'turn_of_month', 'holiday_proximity', 'options_expiry']
    assert agent.metadata.long_only is False


def test_generate_signal_not_yet_implemented():
    agent = SeasonalityExpert()
    with pytest.raises(NotImplementedError):
        agent.generate_signal(pd.DataFrame())


@pytest.mark.skip(reason="Implement once generate_signal is built (Phase 1/2)")
def test_signal_values_are_within_allowed_range():
    agent = SeasonalityExpert()
    signal = agent.generate_signal(pd.DataFrame())
    agent.validate_output(signal)
