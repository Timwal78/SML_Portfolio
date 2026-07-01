"""Unit tests for Agent 09 — VolumeConfirmer."""

import pandas as pd
import pytest

from src.agents.agent_09_volume_confirmer import VolumeConfirmer


def test_metadata_matches_spec():
    agent = VolumeConfirmer()
    assert agent.metadata.agent_id == 9
    assert agent.metadata.name == "VolumeConfirmer"
    assert agent.metadata.factors == ['obv', 'volume_momentum', 'vwap_deviation', 'amihud_illiquidity']
    assert agent.metadata.long_only is False


def test_generate_signal_not_yet_implemented():
    agent = VolumeConfirmer()
    with pytest.raises(NotImplementedError):
        agent.generate_signal(pd.DataFrame())


@pytest.mark.skip(reason="Implement once generate_signal is built (Phase 1/2)")
def test_signal_values_are_within_allowed_range():
    agent = VolumeConfirmer()
    signal = agent.generate_signal(pd.DataFrame())
    agent.validate_output(signal)
