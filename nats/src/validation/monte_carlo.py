"""Monte Carlo Sharpe significance test (spec UPGRADE 7).

For each agent: permute returns `n_simulations` times, compute the
permuted Sharpe each time, and report the fraction of permutations that
beat the observed Sharpe. Agents require p-value < 0.05 to enter the
ensemble (spec non-negotiable #15).
"""

from __future__ import annotations

import numpy as np


def _sharpe(returns: np.ndarray) -> float:
    std = returns.std(ddof=1)
    return float(returns.mean() / std) if std > 0 else 0.0


def monte_carlo_sharpe_pvalue(
    returns: np.ndarray,
    n_simulations: int = 10_000,
    random_state: int | None = None,
) -> float:
    returns = np.asarray(returns, dtype=float)
    returns = returns[~np.isnan(returns)]
    observed_sharpe = _sharpe(returns)

    rng = np.random.default_rng(random_state)
    n = len(returns)
    beats = 0
    for _ in range(n_simulations):
        permuted = rng.permutation(returns)
        # Randomize sign to build a null distribution centered on zero skill,
        # consistent with testing "is this Sharpe distinguishable from noise".
        signs = rng.choice([-1.0, 1.0], size=n)
        permuted_sharpe = _sharpe(permuted * signs)
        if permuted_sharpe >= observed_sharpe:
            beats += 1

    return beats / n_simulations
