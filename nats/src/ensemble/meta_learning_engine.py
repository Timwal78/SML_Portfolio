"""Meta-learning ensemble weight engine.

Implements the spec's ensemble construction rules:
  1. Each agent generates a daily signal in {-1, 0, +1}.
  2. Performance score = Sharpe * (1 + max_drawdown_penalty).
  3. Dynamic weight = 0.60 * base_allocation + 0.40 * rolling_30d_Sharpe.
  4. Rebalance weekly (not daily) to reduce churn.
  5. Ensemble signal = weighted vote; trade only if |signal| > trade_threshold.
  6. Weight floors/caps: no agent below min_agent_weight, none above
     max_agent_weight. Agent 20 (ShadowFlowHunter) is excluded from the
     vote entirely and always held at exactly shadow_flow_cap — see
     shadow_flow/shadow_flow_hunter.py.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd


@dataclass
class EnsembleConfig:
    base_allocation_weight: float = 0.60
    performance_weight: float = 0.40
    trade_threshold: float = 0.05
    min_agent_weight: float = 0.02
    max_agent_weight: float = 0.20
    shadow_flow_cap: float = 0.01


def performance_score(sharpe: float, max_drawdown: float) -> float:
    """`max_drawdown` is a positive fraction (e.g. 0.12 for -12% DD).
    Penalty scales down the score as drawdown worsens.
    """
    drawdown_penalty = -max_drawdown
    return sharpe * (1 + drawdown_penalty)


class MetaLearningEnsemble:
    SHADOW_FLOW_NAME = "ShadowFlowHunter"

    def __init__(self, config: EnsembleConfig, base_allocations: dict[str, float]):
        self.config = config
        self.base_allocations = base_allocations

    def compute_weights(self, rolling_30d_sharpe: dict[str, float]) -> dict[str, float]:
        """Voting agents (excludes ShadowFlowHunter) get a floor/cap-clamped
        weight; water-filled to sum to (1 - shadow_flow_cap).

        Naively renormalizing after clamping can push a weight back outside
        [floor, cap] (e.g. two agents clamped to 0.20 renormalized up to a
        0.99 budget would each need 0.495). Water-filling clamps and locks
        violating weights iteratively, only renormalizing the remaining
        free agents each pass, so the floor/cap are honored exactly.
        Requires `min_agent_weight * n <= budget <= max_agent_weight * n`
        for the voting agent count `n` — true for the spec's 19 voting
        agents (0.38 <= 0.99 <= 3.80), but callers with very small agent
        counts should widen the floor/cap accordingly.
        """
        voting_names = [n for n in self.base_allocations if n != self.SHADOW_FLOW_NAME]
        budget = 1.0 - self.config.shadow_flow_cap

        raw_weights = {}
        for name in voting_names:
            base = self.base_allocations[name]
            perf = rolling_30d_sharpe.get(name, 0.0)
            raw = (
                self.config.base_allocation_weight * base
                + self.config.performance_weight * perf
            )
            raw_weights[name] = max(raw, 0.0)

        final_weights = self._water_fill(raw_weights, budget)
        final_weights[self.SHADOW_FLOW_NAME] = self.config.shadow_flow_cap
        return final_weights

    def _water_fill(self, raw_weights: dict[str, float], budget: float) -> dict[str, float]:
        """Every agent starts at `floor`; the remaining budget is then
        distributed proportionally to `raw_weights` among agents not yet
        capped, repeating until no agent's allocation would exceed `cap`.
        Starting from the floor baseline guarantees the floor is never
        violated (shares added are always >= 0), so only cap violations
        need to be resolved iteratively.
        """
        floor, cap = self.config.min_agent_weight, self.config.max_agent_weight
        names = list(raw_weights)
        n = len(names)

        base_total = floor * n
        if base_total > budget + 1e-9:
            raise ValueError(
                f"min_agent_weight * {n} agents ({base_total}) exceeds budget ({budget}) — "
                "widen the floor/cap or reduce the voting agent count."
            )

        weights = {name: floor for name in names}
        remaining = budget - base_total
        free = set(names)

        for _ in range(n + 1):
            if not free or remaining <= 1e-12:
                break
            free_raw_total = sum(raw_weights[m] for m in free)
            shares = (
                {m: (raw_weights[m] / free_raw_total) * remaining for m in free}
                if free_raw_total > 0
                else {m: remaining / len(free) for m in free}
            )

            violators = {m for m in free if weights[m] + shares[m] > cap}
            if not violators:
                for m in free:
                    weights[m] += shares[m]
                break

            for m in violators:
                remaining -= cap - weights[m]
                weights[m] = cap
                free.discard(m)

        return weights

    def ensemble_signal(
        self, agent_signals: dict[str, int], weights: dict[str, float]
    ) -> tuple[float, bool]:
        """Weighted vote across signal-contributing agents (excludes
        ShadowFlowHunter, which is an overlay, not a vote). Returns
        (weighted_signal, should_trade).
        """
        voting_names = [n for n in agent_signals if n != self.SHADOW_FLOW_NAME]
        weighted_signal = sum(
            agent_signals[name] * weights.get(name, 0.0) for name in voting_names
        )
        should_trade = abs(weighted_signal) > self.config.trade_threshold
        return weighted_signal, should_trade
