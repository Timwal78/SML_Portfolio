"""Unit tests for Agent 11 — FearGreedContrarian."""

import pandas as pd

from src.agents.agent_11_fear_greed_contrarian import FearGreedContrarian


def test_metadata_matches_spec():
    agent = FearGreedContrarian()
    assert agent.metadata.agent_id == 11
    assert agent.metadata.name == "FearGreedContrarian"
    assert agent.metadata.factors == ['vix_momentum', 'vix_zscore_90d', 'price_extension_vs_200dma']
    assert agent.metadata.long_only is False


def _frame(**overrides):
    base = {"vix_momentum": 0.0, "vix_zscore_90d": 0.0, "price_extension_vs_200dma": 0.0}
    base.update(overrides)
    return pd.DataFrame([base])


def test_signal_values_are_within_allowed_range():
    agent = FearGreedContrarian()
    signal = agent.generate_signal(_frame())
    agent.validate_output(signal)


def test_extreme_fear_buy_signal():
    agent = FearGreedContrarian()
    signal = agent.generate_signal(_frame(vix_zscore_90d=2.5))
    assert signal.iloc[0] == 1


def test_extreme_complacency_sell_signal():
    agent = FearGreedContrarian()
    signal = agent.generate_signal(_frame(vix_zscore_90d=-1.5, price_extension_vs_200dma=0.15))
    assert signal.iloc[0] == -1


def test_neutral_in_normal_regime():
    agent = FearGreedContrarian()
    signal = agent.generate_signal(_frame(vix_zscore_90d=0.5, price_extension_vs_200dma=0.02))
    assert signal.iloc[0] == 0
