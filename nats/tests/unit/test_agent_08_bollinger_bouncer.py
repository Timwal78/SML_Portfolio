"""Unit tests for Agent 08 — BollingerBouncer."""

import pandas as pd

from src.agents.agent_08_bollinger_bouncer import BollingerBouncer


def test_metadata_matches_spec():
    agent = BollingerBouncer()
    assert agent.metadata.agent_id == 8
    assert agent.metadata.name == "BollingerBouncer"
    assert agent.metadata.factors == ['bollinger_position', 'bollinger_width', 'rsi_14', 'volume_confirmation']
    assert agent.metadata.long_only is False


def _frame(**overrides):
    base = {"bollinger_position": 0.5, "bollinger_width": 0.1, "rsi_14": 50.0, "volume_confirmation": 0.0}
    base.update(overrides)
    return pd.DataFrame([base])


def test_signal_values_are_within_allowed_range():
    agent = BollingerBouncer()
    signal = agent.generate_signal(_frame())
    agent.validate_output(signal)


def test_buy_at_lower_band_extreme_with_volume():
    agent = BollingerBouncer()
    signal = agent.generate_signal(_frame(bollinger_position=0.02, rsi_14=25.0, volume_confirmation=1.0))
    assert signal.iloc[0] == 1


def test_sell_at_upper_band_extreme_with_volume():
    agent = BollingerBouncer()
    signal = agent.generate_signal(_frame(bollinger_position=0.98, rsi_14=75.0, volume_confirmation=1.0))
    assert signal.iloc[0] == -1


def test_neutral_without_volume_confirmation():
    agent = BollingerBouncer()
    signal = agent.generate_signal(_frame(bollinger_position=0.02, rsi_14=25.0, volume_confirmation=0.0))
    assert signal.iloc[0] == 0
