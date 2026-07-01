"""Unit tests for Agent 09 — VolumeConfirmer."""

import pandas as pd

from src.agents.agent_09_volume_confirmer import VolumeConfirmer


def test_metadata_matches_spec():
    agent = VolumeConfirmer()
    assert agent.metadata.agent_id == 9
    assert agent.metadata.name == "VolumeConfirmer"
    assert agent.metadata.factors == ['obv', 'volume_momentum', 'vwap_deviation', 'amihud_illiquidity']
    assert agent.metadata.long_only is False


def _frame(obv_prev, obv_last, **overrides):
    base = {
        "obv": [obv_prev, obv_last],
        "volume_momentum": [0.0, overrides.get("volume_momentum", 0.0)],
        "vwap_deviation": [0.0, overrides.get("vwap_deviation", 0.0)],
        "amihud_illiquidity": [0.0, 0.0],
    }
    return pd.DataFrame(base)


def test_signal_values_are_within_allowed_range():
    agent = VolumeConfirmer()
    signal = agent.generate_signal(_frame(100, 100))
    agent.validate_output(signal)


def test_confirm_signal_when_price_volume_and_obv_all_rise():
    agent = VolumeConfirmer()
    frame = _frame(100, 150, volume_momentum=0.1, vwap_deviation=0.02)
    signal = agent.generate_signal(frame)
    assert signal.iloc[-1] == 1


def test_diverge_signal_when_obv_fails_to_confirm():
    agent = VolumeConfirmer()
    frame = _frame(100, 90, volume_momentum=0.1, vwap_deviation=0.02)
    signal = agent.generate_signal(frame)
    assert signal.iloc[-1] == -1
