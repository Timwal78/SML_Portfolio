"""Unit tests for Agent 14 — OptionsFlowReader."""

import pandas as pd
import pytest

from src.agents.agent_14_options_flow_reader import OptionsFlowReader


def test_metadata_matches_spec():
    agent = OptionsFlowReader()
    assert agent.metadata.agent_id == 14
    assert agent.metadata.name == "OptionsFlowReader"
    assert agent.metadata.factors == ['unusual_oi_spike_3sigma', 'put_call_ratio_extreme', 'itm_call_buying']
    assert agent.metadata.long_only is False


def test_generate_signal_not_yet_implemented():
    agent = OptionsFlowReader()
    with pytest.raises(NotImplementedError):
        agent.generate_signal(pd.DataFrame())


@pytest.mark.skip(reason="Implement once generate_signal is built (Phase 1/2)")
def test_signal_values_are_within_allowed_range():
    agent = OptionsFlowReader()
    signal = agent.generate_signal(pd.DataFrame())
    agent.validate_output(signal)
