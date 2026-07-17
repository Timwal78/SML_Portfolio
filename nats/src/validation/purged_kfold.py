"""Purged K-Fold cross-validation with embargo (Lopez de Prado, Advances in
Financial Machine Learning, ch. 7). Spec UPGRADE 3: n_splits=5,
embargo_bars=5 — prevents regime leakage at fold boundaries by purging
training samples whose label window overlaps the test set, and embargoing
a buffer immediately after each test fold.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class PurgedKFold:
    n_splits: int = 5
    embargo_bars: int = 5

    def split(self, n_samples: int) -> list[tuple[np.ndarray, np.ndarray]]:
        """Returns a list of (train_indices, test_indices) tuples.

        Each test fold is a contiguous block. Training indices exclude the
        test block itself plus an embargo window of `embargo_bars` samples
        immediately following the test block (purging lookahead leakage
        from labels/factors whose windows span the boundary).
        """
        if self.n_splits < 2:
            raise ValueError("n_splits must be >= 2")
        indices = np.arange(n_samples)
        fold_sizes = np.full(self.n_splits, n_samples // self.n_splits, dtype=int)
        fold_sizes[: n_samples % self.n_splits] += 1

        splits: list[tuple[np.ndarray, np.ndarray]] = []
        current = 0
        for fold_size in fold_sizes:
            test_start, test_end = current, current + fold_size
            test_idx = indices[test_start:test_end]

            embargo_end = min(test_end + self.embargo_bars, n_samples)
            train_mask = np.ones(n_samples, dtype=bool)
            train_mask[test_start:embargo_end] = False
            train_idx = indices[train_mask]

            splits.append((train_idx, test_idx))
            current = test_end

        return splits
