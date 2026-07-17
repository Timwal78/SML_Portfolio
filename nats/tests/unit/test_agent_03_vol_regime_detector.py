"""Unit tests for Agent 03 — VolRegimeDetector."""

import pandas as pd

from src.agents.agent_03_vol_regime_detector import VolRegimeDetector


def test_metadata_matches_spec():
    agent = VolRegimeDetector()
    assert agent.metadata.agent_id == 3
    assert agent.metadata.name == "VolRegimeDetector"
    assert agent.metadata.factors == ['vol_5d', 'vol_10d', 'vol_20d', 'vol_of_vol', 'vix_momentum', 'parkinson']
    assert agent.metadata.long_only is False


def _frame(n=25, **overrides):
    base = pd.DataFrame({
        "vol_5d": [0.01] * n,
        "vol_10d": [0.01] * n,
        "vol_20d": [0.01] * n,
        "vol_of_vol": [0.001] * n,
        "vix_momentum": [0.0] * n,
        "parkinson": [0.01] * n,
    })
    for key, value in overrides.items():
        base.loc[base.index[-1], key] = value
    return base


def test_signal_values_are_within_allowed_range():
    agent = VolRegimeDetector()
    signal = agent.generate_signal(_frame())
    agent.validate_output(signal)


def test_high_vol_spike_signal():
    agent = VolRegimeDetector()
    frame = _frame(vix_momentum=0.20, vol_of_vol=0.05)
    signal = agent.generate_signal(frame)
    assert signal.iloc[-1] == -1


def test_low_vol_expansion_signal():
    agent = VolRegimeDetector()
    frame = _frame(vix_momentum=-0.20, vol_of_vol=0.0001)
    signal = agent.generate_signal(frame)
    assert signal.iloc[-1] == 1
