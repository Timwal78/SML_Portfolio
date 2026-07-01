"""Unit tests for Agent 01 — MomentumHunter."""

import pandas as pd

from src.agents.agent_01_momentum_hunter import MomentumHunter


def test_metadata_matches_spec():
    agent = MomentumHunter()
    assert agent.metadata.agent_id == 1
    assert agent.metadata.name == "MomentumHunter"
    assert agent.metadata.factors == ['mom_3d', 'mom_5d', 'mom_10d', 'mom_15d', 'mom_20d', 'acceleration']
    assert agent.metadata.long_only is False


def _frame(**overrides):
    base = {"mom_3d": 0.0, "mom_5d": 0.0, "mom_10d": 0.0, "mom_15d": 0.0, "mom_20d": 0.0, "acceleration": 0.0}
    base.update(overrides)
    return pd.DataFrame([base])


def test_signal_values_are_within_allowed_range():
    agent = MomentumHunter()
    signal = agent.generate_signal(_frame())
    agent.validate_output(signal)


def test_buy_signal_on_aligned_accelerating_uptrend():
    agent = MomentumHunter()
    frame = _frame(mom_3d=0.02, mom_5d=0.03, mom_10d=0.04, mom_15d=-0.01, mom_20d=0.01, acceleration=0.02)
    signal = agent.generate_signal(frame)
    assert signal.iloc[0] == 1


def test_sell_signal_on_aligned_decelerating_downtrend():
    agent = MomentumHunter()
    frame = _frame(mom_3d=-0.02, mom_5d=-0.03, mom_10d=-0.04, mom_15d=0.01, mom_20d=-0.01, acceleration=-0.02)
    signal = agent.generate_signal(frame)
    assert signal.iloc[0] == -1


def test_neutral_when_horizons_disagree():
    agent = MomentumHunter()
    frame = _frame(mom_3d=0.02, mom_5d=-0.02, mom_10d=0.01, mom_15d=-0.01, mom_20d=0.0, acceleration=0.01)
    signal = agent.generate_signal(frame)
    assert signal.iloc[0] == 0
