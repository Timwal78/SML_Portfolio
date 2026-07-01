"""Unit tests for Agent 17 — OrderFlowImbalance."""

import pandas as pd
import pytest

from src.agents.agent_17_order_flow_imbalance import OrderFlowImbalance


def test_metadata_matches_spec():
    agent = OrderFlowImbalance()
    assert agent.metadata.agent_id == 17
    assert agent.metadata.name == "OrderFlowImbalance"
    assert agent.metadata.factors == ['bid_ask_imbalance_ratio_2sigma', 'depth_of_book_skew', 'tape_speed']
    assert agent.metadata.long_only is False


def test_generate_signal_not_yet_implemented():
    agent = OrderFlowImbalance()
    with pytest.raises(NotImplementedError):
        agent.generate_signal(pd.DataFrame())


@pytest.mark.skip(reason="Implement once generate_signal is built (Phase 1/2)")
def test_signal_values_are_within_allowed_range():
    agent = OrderFlowImbalance()
    signal = agent.generate_signal(pd.DataFrame())
    agent.validate_output(signal)
