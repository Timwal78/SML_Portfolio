"""Unit tests for Agent 16 — EconSurpriseTrader."""

import pandas as pd
import pytest

from src.agents.agent_16_econ_surprise_trader import EconSurpriseTrader


def test_metadata_matches_spec():
    agent = EconSurpriseTrader()
    assert agent.metadata.agent_id == 16
    assert agent.metadata.name == "EconSurpriseTrader"
    assert agent.metadata.factors == ['cpi_surprise', 'nfp_surprise', 'pmi_surprise', 'yield_curve_reaction']
    assert agent.metadata.long_only is False


def test_generate_signal_not_yet_implemented():
    agent = EconSurpriseTrader()
    with pytest.raises(NotImplementedError):
        agent.generate_signal(pd.DataFrame())


@pytest.mark.skip(reason="Implement once generate_signal is built (Phase 1/2)")
def test_signal_values_are_within_allowed_range():
    agent = EconSurpriseTrader()
    signal = agent.generate_signal(pd.DataFrame())
    agent.validate_output(signal)
