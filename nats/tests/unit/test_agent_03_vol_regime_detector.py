"""Unit tests for Agent 03 — VolRegimeDetector."""

import pandas as pd
import pytest

from src.agents.agent_03_vol_regime_detector import VolRegimeDetector


def test_metadata_matches_spec():
    agent = VolRegimeDetector()
    assert agent.metadata.agent_id == 3
    assert agent.metadata.name == "VolRegimeDetector"
    assert agent.metadata.factors == ['vol_5d', 'vol_10d', 'vol_20d', 'vol_of_vol', 'vix_momentum', 'parkinson']
    assert agent.metadata.long_only is False


def test_generate_signal_not_yet_implemented():
    agent = VolRegimeDetector()
    with pytest.raises(NotImplementedError):
        agent.generate_signal(pd.DataFrame())


@pytest.mark.skip(reason="Implement once generate_signal is built (Phase 1/2)")
def test_signal_values_are_within_allowed_range():
    agent = VolRegimeDetector()
    signal = agent.generate_signal(pd.DataFrame())
    agent.validate_output(signal)
