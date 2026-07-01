"""Unit tests for Agent 15 — StatArb."""

import pandas as pd
import pytest

from src.agents.agent_15_stat_arb import StatArb


def test_metadata_matches_spec():
    agent = StatArb()
    assert agent.metadata.agent_id == 15
    assert agent.metadata.name == "StatArb"
    assert agent.metadata.factors == ['spread_zscore', 'half_life_mean_reversion', 'cointegration_pvalue']
    assert agent.metadata.long_only is False


def test_generate_signal_not_yet_implemented():
    agent = StatArb()
    with pytest.raises(NotImplementedError):
        agent.generate_signal(pd.DataFrame())


@pytest.mark.skip(reason="Implement once generate_signal is built (Phase 1/2)")
def test_signal_values_are_within_allowed_range():
    agent = StatArb()
    signal = agent.generate_signal(pd.DataFrame())
    agent.validate_output(signal)
