from src.shadow_flow.shadow_flow_hunter import evaluate, should_exit


def test_signal_zero_with_only_two_indicators_triggered():
    result = evaluate(
        ticker="GME",
        ftd_zscore=4.0,  # triggers (>3)
        etf_basket_divergence=0.25,  # triggers (>0.20)
        dark_pool_pct=0.30,  # no trigger (<0.60)
        synthetic_short_score=0.40,  # no trigger (<0.65)
        short_int_divergence=-0.10,  # no trigger (<=0)
    )
    assert result.indicators_triggered == 2
    assert result.signal == 0
    assert result.squeeze_probability == 0.0


def test_signal_one_with_three_plus_indicators_and_never_negative():
    result = evaluate(
        ticker="AMC",
        ftd_zscore=4.0,
        etf_basket_divergence=0.25,
        dark_pool_pct=0.70,
        synthetic_short_score=0.40,
        short_int_divergence=-0.10,
    )
    assert result.indicators_triggered == 3
    assert result.signal == 1
    assert result.signal != -1
    assert result.confidence == 0.25 + 0.20 + 0.20
    assert 0 < result.squeeze_probability <= 0.95


def test_should_exit_on_profit_target_stop_or_normalization():
    assert should_exit(indicators_normalized_count=0, unrealized_pnl_pct=0.16) is True
    assert should_exit(indicators_normalized_count=0, unrealized_pnl_pct=-0.06) is True
    assert should_exit(indicators_normalized_count=2, unrealized_pnl_pct=0.02) is True
    assert should_exit(indicators_normalized_count=0, unrealized_pnl_pct=0.02) is False
