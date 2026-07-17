"""Unit tests for Agent 10 — TrendFollower."""

import pandas as pd

from src.agents.agent_10_trend_follower import TrendFollower


def test_metadata_matches_spec():
    agent = TrendFollower()
    assert agent.metadata.agent_id == 10
    assert agent.metadata.name == "TrendFollower"
    assert agent.metadata.factors == ['mom_5d', 'mom_20d', 'atr_stop', 'kelly_fraction']
    assert agent.metadata.long_only is False


def _frame(**overrides):
    base = {"mom_5d": 0.0, "mom_20d": 0.0, "atr_stop": 0.0, "kelly_fraction": 0.0}
    base.update(overrides)
    return pd.DataFrame([base])


def test_signal_values_are_within_allowed_range():
    agent = TrendFollower()
    signal = agent.generate_signal(_frame())
    agent.validate_output(signal)


def test_strong_uptrend_signal():
    agent = TrendFollower()
    signal = agent.generate_signal(_frame(mom_5d=0.03, mom_20d=0.08))
    assert signal.iloc[0] == 1


def test_strong_downtrend_signal():
    agent = TrendFollower()
    signal = agent.generate_signal(_frame(mom_5d=-0.03, mom_20d=-0.08))
    assert signal.iloc[0] == -1


def test_neutral_when_horizons_disagree():
    agent = TrendFollower()
    signal = agent.generate_signal(_frame(mom_5d=0.03, mom_20d=-0.08))
    assert signal.iloc[0] == 0
