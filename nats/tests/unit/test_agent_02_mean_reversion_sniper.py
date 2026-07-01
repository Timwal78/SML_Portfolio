"""Unit tests for Agent 02 — MeanReversionSniper."""

import pandas as pd
import pytest

from src.agents.agent_02_mean_reversion_sniper import MeanReversionSniper


def test_metadata_matches_spec():
    agent = MeanReversionSniper()
    assert agent.metadata.agent_id == 2
    assert agent.metadata.name == "MeanReversionSniper"
    assert agent.metadata.factors == ['rsi_14', 'williams_r', 'bollinger_position', 'z_score', 'volume_confirmation']
    assert agent.metadata.long_only is False


def test_generate_signal_not_yet_implemented():
    agent = MeanReversionSniper()
    with pytest.raises(NotImplementedError):
        agent.generate_signal(pd.DataFrame())


@pytest.mark.skip(reason="Implement once generate_signal is built (Phase 1/2)")
def test_signal_values_are_within_allowed_range():
    agent = MeanReversionSniper()
    signal = agent.generate_signal(pd.DataFrame())
    agent.validate_output(signal)
