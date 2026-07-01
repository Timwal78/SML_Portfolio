"""Unit tests for Agent 18 — SentimentVelocity."""

import pandas as pd
import pytest

from src.agents.agent_18_sentiment_velocity import SentimentVelocity


def test_metadata_matches_spec():
    agent = SentimentVelocity()
    assert agent.metadata.agent_id == 18
    assert agent.metadata.name == "SentimentVelocity"
    assert agent.metadata.factors == ['news_sentiment_velocity', 'sentiment_acceleration']
    assert agent.metadata.long_only is False


def test_generate_signal_not_yet_implemented():
    agent = SentimentVelocity()
    with pytest.raises(NotImplementedError):
        agent.generate_signal(pd.DataFrame())


@pytest.mark.skip(reason="Implement once generate_signal is built (Phase 1/2)")
def test_signal_values_are_within_allowed_range():
    agent = SentimentVelocity()
    signal = agent.generate_signal(pd.DataFrame())
    agent.validate_output(signal)
