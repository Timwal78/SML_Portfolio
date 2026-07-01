import numpy as np
import pytest

from src.validation.deflated_sharpe import deflated_sharpe_ratio, expected_max_sharpe_from_trials
from src.validation.monte_carlo import monte_carlo_sharpe_pvalue
from src.validation.multiple_testing import benjamini_hochberg
from src.validation.psr import probabilistic_sharpe_ratio
from src.validation.purged_kfold import PurgedKFold
from src.validation.regime_coverage import check_regime_coverage
import pandas as pd


def test_psr_high_for_strong_consistent_returns():
    rng = np.random.default_rng(42)
    returns = rng.normal(loc=0.002, scale=0.005, size=500)
    psr = probabilistic_sharpe_ratio(returns, sharpe_benchmark=0.0)
    assert 0.0 <= psr <= 1.0
    assert psr > 0.9


def test_psr_low_for_noise():
    rng = np.random.default_rng(1)
    returns = rng.normal(loc=0.0, scale=0.01, size=50)
    psr = probabilistic_sharpe_ratio(returns, sharpe_benchmark=0.0)
    assert 0.0 <= psr <= 1.0


def test_deflated_sharpe_lower_than_psr_for_many_trials():
    rng = np.random.default_rng(7)
    returns = rng.normal(loc=0.001, scale=0.01, size=500)
    plain_psr = probabilistic_sharpe_ratio(returns)
    dsr = deflated_sharpe_ratio(returns, n_trials=20, trial_sharpe_std=0.3)
    assert dsr <= plain_psr


def test_expected_max_sharpe_increases_with_trials():
    low = expected_max_sharpe_from_trials(2, trial_sharpe_std=0.3)
    high = expected_max_sharpe_from_trials(20, trial_sharpe_std=0.3)
    assert high > low


def test_monte_carlo_pvalue_low_for_strong_signal():
    rng = np.random.default_rng(3)
    returns = rng.normal(loc=0.01, scale=0.005, size=200)
    p = monte_carlo_sharpe_pvalue(returns, n_simulations=500, random_state=0)
    assert 0.0 <= p <= 1.0


def test_benjamini_hochberg_rejects_weak_agents():
    pvals = {f"agent_{i}": v for i, v in enumerate([0.001, 0.002, 0.20, 0.35, 0.50])}
    result = benjamini_hochberg(pvals, alpha=0.05)
    assert result["agent_0"] is True
    assert result["agent_4"] is False


def test_purged_kfold_splits_cover_all_indices_and_purge_embargo():
    pkf = PurgedKFold(n_splits=5, embargo_bars=5)
    splits = pkf.split(n_samples=100)
    assert len(splits) == 5
    all_test = np.concatenate([test for _, test in splits])
    assert sorted(all_test.tolist()) == list(range(100))
    for train, test in splits:
        assert set(train.tolist()).isdisjoint(set(test.tolist()))


def test_regime_coverage_flags_underrepresented_regime():
    labels = pd.Series(["bull_market"] * 80 + ["bear_market"] * 5 + ["high_volatility"] * 10 + ["crisis"] * 5)
    result = check_regime_coverage(labels)
    assert result.passed["bull_market"] is True
    assert result.passed["bear_market"] is False
    assert result.all_passed is False
