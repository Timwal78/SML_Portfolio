"""Unit tests for Agent 11 — FearGreedContrarian."""

import pandas as pd
import pytest

from src.agents.agent_11_fear_greed_contrarian import FearGreedContrarian


def test_metadata_matches_spec():
    agent = FearGreedContrarian()
    assert agent.metadata.agent_id == 11
    assert agent.metadata.name == "FearGreedContrarian"
    assert agent.metadata.factors == ['vix_momentum', 'vix_zscore_90d', 'price_extension_vs_200dma']
    assert agent.metadata.long_only is False


def test_generate_signal_not_yet_implemented():
    agent = FearGreedContrarian()
    with pytest.raises(NotImplementedError):
        agent.generate_signal(pd.DataFrame())


@pytest.mark.skip(reason="Implement once generate_signal is built (Phase 1/2)")
def test_signal_values_are_within_allowed_range():
    agent = FearGreedContrarian()
    signal = agent.generate_signal(pd.DataFrame())
    agent.validate_output(signal)
