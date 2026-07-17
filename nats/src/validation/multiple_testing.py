"""Benjamini-Hochberg FDR correction (spec UPGRADE 6).

Applied across all 20 agents' Monte Carlo p-values before any agent is
admitted to the ensemble — controls the false discovery rate when testing
20 hypotheses simultaneously rather than accepting each at raw p < 0.05.
"""

from __future__ import annotations

import numpy as np


def benjamini_hochberg(p_values: dict[str, float], alpha: float = 0.05) -> dict[str, bool]:
    """Returns {agent_name: passes_fdr_corrected_threshold} for each input."""
    names = list(p_values.keys())
    pvals = np.array([p_values[name] for name in names])
    n = len(pvals)

    order = np.argsort(pvals)
    sorted_pvals = pvals[order]
    thresholds = (np.arange(1, n + 1) / n) * alpha

    passes_sorted = sorted_pvals <= thresholds
    # BH rule: find the largest k where p_(k) <= (k/n) * alpha; all i <= k pass.
    if passes_sorted.any():
        max_k = np.max(np.where(passes_sorted)[0])
        passes_sorted = np.zeros(n, dtype=bool)
        passes_sorted[: max_k + 1] = True

    result = np.zeros(n, dtype=bool)
    result[order] = passes_sorted
    return {name: bool(result[i]) for i, name in enumerate(names)}
