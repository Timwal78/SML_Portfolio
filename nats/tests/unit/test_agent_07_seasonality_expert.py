"""Unit tests for Agent 07 — SeasonalityExpert."""

import pandas as pd

from src.agents.agent_07_seasonality_expert import SeasonalityExpert


def test_metadata_matches_spec():
    agent = SeasonalityExpert()
    assert agent.metadata.agent_id == 7
    assert agent.metadata.name == "SeasonalityExpert"
    assert agent.metadata.factors == ['day_of_week_effect', 'turn_of_month', 'holiday_proximity', 'options_expiry']
    assert agent.metadata.long_only is False


def _frame(**overrides):
    base = {"day_of_week_effect": 0.0, "turn_of_month": 0.0, "holiday_proximity": 0.0, "options_expiry": 0.0}
    base.update(overrides)
    return pd.DataFrame([base])


def test_signal_values_are_within_allowed_range():
    agent = SeasonalityExpert()
    signal = agent.generate_signal(_frame())
    agent.validate_output(signal)


def test_passes_through_day_of_week_effect():
    agent = SeasonalityExpert()
    signal = agent.generate_signal(_frame(day_of_week_effect=1.0))
    assert signal.iloc[0] == 1


def test_turn_of_month_boosts_neutral_day():
    agent = SeasonalityExpert()
    signal = agent.generate_signal(_frame(day_of_week_effect=0.0, turn_of_month=1.0))
    assert signal.iloc[0] == 1


def test_holiday_proximity_dampens_signal():
    agent = SeasonalityExpert()
    signal = agent.generate_signal(_frame(day_of_week_effect=1.0, holiday_proximity=1.0))
    assert signal.iloc[0] == 0
