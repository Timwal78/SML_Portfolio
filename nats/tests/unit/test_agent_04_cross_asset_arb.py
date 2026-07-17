"""Unit tests for Agent 04 — CrossAssetArb."""

import pandas as pd
import pytest

from src.agents.agent_04_cross_asset_arb import CrossAssetArb


def test_metadata_matches_spec():
    agent = CrossAssetArb()
    assert agent.metadata.agent_id == 4
    assert agent.metadata.name == "CrossAssetArb"
    assert agent.metadata.factors == ['eq_bond_correlation_20d', 'risk_on_score', 'flight_to_quality']
    assert agent.metadata.long_only is False


def test_generate_signal_not_yet_implemented():
    agent = CrossAssetArb()
    with pytest.raises(NotImplementedError):
        agent.generate_signal(pd.DataFrame())


@pytest.mark.skip(reason="Implement once generate_signal is built (Phase 1/2)")
def test_signal_values_are_within_allowed_range():
    agent = CrossAssetArb()
    signal = agent.generate_signal(pd.DataFrame())
    agent.validate_output(signal)
