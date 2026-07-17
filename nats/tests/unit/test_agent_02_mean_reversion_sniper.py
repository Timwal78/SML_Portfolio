"""Unit tests for Agent 02 — MeanReversionSniper."""

import pandas as pd

from src.agents.agent_02_mean_reversion_sniper import MeanReversionSniper


def test_metadata_matches_spec():
    agent = MeanReversionSniper()
    assert agent.metadata.agent_id == 2
    assert agent.metadata.name == "MeanReversionSniper"
    assert agent.metadata.factors == ['rsi_14', 'williams_r', 'bollinger_position', 'z_score', 'volume_confirmation']
    assert agent.metadata.long_only is False


def _frame(**overrides):
    base = {"rsi_14": 50.0, "williams_r": -50.0, "bollinger_position": 0.5, "z_score": 0.0, "volume_confirmation": 0.0}
    base.update(overrides)
    return pd.DataFrame([base])


def test_signal_values_are_within_allowed_range():
    agent = MeanReversionSniper()
    signal = agent.generate_signal(_frame())
    agent.validate_output(signal)


def test_buy_signal_on_oversold_with_volume_spike():
    agent = MeanReversionSniper()
    signal = agent.generate_signal(_frame(rsi_14=25.0, volume_confirmation=1.0))
    assert signal.iloc[0] == 1


def test_sell_signal_on_overbought_with_volume_spike():
    agent = MeanReversionSniper()
    signal = agent.generate_signal(_frame(rsi_14=75.0, volume_confirmation=1.0))
    assert signal.iloc[0] == -1


def test_neutral_without_volume_confirmation():
    agent = MeanReversionSniper()
    signal = agent.generate_signal(_frame(rsi_14=25.0, volume_confirmation=0.0))
    assert signal.iloc[0] == 0
