"""Unit tests for Agent 19 — CreditSpreadReader."""

import pandas as pd
import pytest

from src.agents.agent_19_credit_spread_reader import CreditSpreadReader


def test_metadata_matches_spec():
    agent = CreditSpreadReader()
    assert agent.metadata.agent_id == 19
    assert agent.metadata.name == "CreditSpreadReader"
    assert agent.metadata.factors == ['hyg_lqd_spread_zscore', 'credit_equity_divergence', 'junk_bond_momentum']
    assert agent.metadata.long_only is False


def test_generate_signal_not_yet_implemented():
    agent = CreditSpreadReader()
    with pytest.raises(NotImplementedError):
        agent.generate_signal(pd.DataFrame())


@pytest.mark.skip(reason="Implement once generate_signal is built (Phase 1/2)")
def test_signal_values_are_within_allowed_range():
    agent = CreditSpreadReader()
    signal = agent.generate_signal(pd.DataFrame())
    agent.validate_output(signal)
