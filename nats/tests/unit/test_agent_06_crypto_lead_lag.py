"""Unit tests for Agent 06 — CryptoLeadLag."""

import pandas as pd
import pytest

from src.agents.agent_06_crypto_lead_lag import CryptoLeadLag


def test_metadata_matches_spec():
    agent = CryptoLeadLag()
    assert agent.metadata.agent_id == 6
    assert agent.metadata.name == "CryptoLeadLag"
    assert agent.metadata.factors == ['btc_momentum', 'crypto_equity_correlation', 'crypto_decoupling_score']
    assert agent.metadata.long_only is False


def test_generate_signal_not_yet_implemented():
    agent = CryptoLeadLag()
    with pytest.raises(NotImplementedError):
        agent.generate_signal(pd.DataFrame())


@pytest.mark.skip(reason="Implement once generate_signal is built (Phase 1/2)")
def test_signal_values_are_within_allowed_range():
    agent = CryptoLeadLag()
    signal = agent.generate_signal(pd.DataFrame())
    agent.validate_output(signal)
