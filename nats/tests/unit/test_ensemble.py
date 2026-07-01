import pytest

from src.ensemble.meta_learning_engine import EnsembleConfig, MetaLearningEnsemble, performance_score


def test_performance_score_penalizes_drawdown():
    high_dd = performance_score(sharpe=1.5, max_drawdown=0.20)
    low_dd = performance_score(sharpe=1.5, max_drawdown=0.02)
    assert high_dd < low_dd


def test_weights_sum_to_one_minus_shadow_flow_cap():
    base_allocations = {f"agent_{i}": 1.0 / 19 for i in range(19)}
    base_allocations["ShadowFlowHunter"] = 0.0
    config = EnsembleConfig()
    ensemble = MetaLearningEnsemble(config, base_allocations)

    rolling_sharpe = {f"agent_{i}": 0.5 for i in range(19)}
    weights = ensemble.compute_weights(rolling_sharpe)

    assert weights["ShadowFlowHunter"] == pytest.approx(config.shadow_flow_cap)
    total = sum(weights.values())
    assert total == pytest.approx(1.0, abs=1e-6)


def test_weight_floor_and_cap_respected():
    # 19 voting agents (spec swarm size minus ShadowFlowHunter) — feasible
    # for floor=0.02/cap=0.20 since budget 0.99 is between 0.02*19=0.38 and
    # 0.20*19=3.80. A 2-agent setup would make the cap infeasible to reach
    # the 0.99 budget, which is a constraint-feasibility issue, not a bug.
    base_allocations = {f"agent_{i}": 0.9 if i == 0 else 0.1 / 18 for i in range(19)}
    base_allocations["ShadowFlowHunter"] = 0.0
    config = EnsembleConfig(min_agent_weight=0.02, max_agent_weight=0.20)
    ensemble = MetaLearningEnsemble(config, base_allocations)
    rolling_sharpe = {f"agent_{i}": 3.0 if i == 0 else -1.0 for i in range(19)}
    weights = ensemble.compute_weights(rolling_sharpe)

    for name in [f"agent_{i}" for i in range(19)]:
        assert weights[name] <= config.max_agent_weight + 1e-6
        assert weights[name] >= config.min_agent_weight - 1e-6
    assert sum(weights.values()) == pytest.approx(1.0, abs=1e-6)


def test_ensemble_signal_trade_threshold():
    config = EnsembleConfig(trade_threshold=0.05)
    ensemble = MetaLearningEnsemble(config, {"a": 0.5, "b": 0.5, "ShadowFlowHunter": 0.0})
    weights = {"a": 0.03, "b": 0.02, "ShadowFlowHunter": 0.01}

    weak_signal, should_trade = ensemble.ensemble_signal({"a": 1, "b": 0}, weights)
    assert should_trade is False

    strong_weights = {"a": 0.5, "b": 0.5, "ShadowFlowHunter": 0.01}
    strong_signal, should_trade_strong = ensemble.ensemble_signal({"a": 1, "b": 1}, strong_weights)
    assert should_trade_strong is True
