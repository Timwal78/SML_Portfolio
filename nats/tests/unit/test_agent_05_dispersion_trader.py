"""Unit tests for Agent 05 — DispersionTrader."""

import pandas as pd
import pytest

from src.agents.agent_05_dispersion_trader import DispersionTrader


def test_metadata_matches_spec():
    agent = DispersionTrader()
    assert agent.metadata.agent_id == 5
    assert agent.metadata.name == "DispersionTrader"
    assert agent.metadata.factors == ['qqq_spy_spread_zscore', 'momentum_divergence', 'rolling_correlation']
    assert agent.metadata.long_only is False


def test_generate_signal_not_yet_implemented():
    agent = DispersionTrader()
    with pytest.raises(NotImplementedError):
        agent.generate_signal(pd.DataFrame())


@pytest.mark.skip(reason="Implement once generate_signal is built (Phase 1/2)")
def test_signal_values_are_within_allowed_range():
    agent = DispersionTrader()
    signal = agent.generate_signal(pd.DataFrame())
    agent.validate_output(signal)
