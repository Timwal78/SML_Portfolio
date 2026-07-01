"""Unit tests for Agent 08 — BollingerBouncer."""

import pandas as pd
import pytest

from src.agents.agent_08_bollinger_bouncer import BollingerBouncer


def test_metadata_matches_spec():
    agent = BollingerBouncer()
    assert agent.metadata.agent_id == 8
    assert agent.metadata.name == "BollingerBouncer"
    assert agent.metadata.factors == ['bollinger_position', 'bollinger_width', 'rsi_14', 'volume_confirmation']
    assert agent.metadata.long_only is False


def test_generate_signal_not_yet_implemented():
    agent = BollingerBouncer()
    with pytest.raises(NotImplementedError):
        agent.generate_signal(pd.DataFrame())


@pytest.mark.skip(reason="Implement once generate_signal is built (Phase 1/2)")
def test_signal_values_are_within_allowed_range():
    agent = BollingerBouncer()
    signal = agent.generate_signal(pd.DataFrame())
    agent.validate_output(signal)
