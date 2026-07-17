"""Rolling regime detection (spec UPGRADE 5).

KMeans fit on an EXPANDING window only — never full-sample. Re-fit daily,
predict t+1 only. This is the only correct way to avoid regime leakage:
fitting on the full sample (including future bars) would let the model
"know" about regime transitions before they happen.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans

REGIME_LABELS = ("risk_on", "risk_off", "neutral", "crisis")


@dataclass
class RegimePrediction:
    date: pd.Timestamp
    cluster: int
    label: str
    confidence: float


class RollingRegimeDetector:
    def __init__(self, n_clusters: int = 4, min_window_bars: int = 252, random_state: int = 42):
        self.n_clusters = n_clusters
        self.min_window_bars = min_window_bars
        self.random_state = random_state
        self._cluster_to_label: dict[int, str] | None = None

    def fit_predict_next(self, features: pd.DataFrame) -> RegimePrediction | None:
        """`features` must contain only bars up to and including `t`. Fits
        KMeans on the full expanding window and predicts the regime for the
        NEXT bar (t+1) using bar t's feature values — this is the point where
        callers must be careful: the returned prediction is for t+1, but is
        computed only from information available at t.
        """
        if len(features) < self.min_window_bars:
            return None

        km = KMeans(n_clusters=self.n_clusters, random_state=self.random_state, n_init=10)
        cluster_assignments = km.fit_predict(features.to_numpy())

        if self._cluster_to_label is None:
            self._cluster_to_label = self._label_clusters(km, features)

        last_features = features.iloc[[-1]].to_numpy()
        next_cluster = int(km.predict(last_features)[0])
        distances = km.transform(last_features)[0]
        confidence = self._distance_to_confidence(distances)

        return RegimePrediction(
            date=features.index[-1],
            cluster=next_cluster,
            label=self._cluster_to_label.get(next_cluster, "neutral"),
            confidence=confidence,
        )

    def _label_clusters(self, km: KMeans, features: pd.DataFrame) -> dict[int, str]:
        """Maps raw cluster IDs to semantic labels. Requires a `vol` and a
        `momentum` column in `features` to disambiguate risk_on/risk_off/
        neutral/crisis by centroid characteristics. Implementers should
        adapt column names to the actual regime feature set chosen in
        Phase 2 — this default mapping is a starting heuristic, not final.
        """
        centroids = pd.DataFrame(km.cluster_centers_, columns=features.columns)
        mapping: dict[int, str] = {}
        if {"vol", "momentum"}.issubset(centroids.columns):
            crisis_id = centroids["vol"].idxmax()
            mapping[crisis_id] = "crisis"
            remaining = centroids.drop(index=crisis_id)
            risk_on_id = remaining["momentum"].idxmax()
            mapping[risk_on_id] = "risk_on"
            risk_off_id = remaining["momentum"].idxmin()
            mapping[risk_off_id] = "risk_off"
            for idx in centroids.index:
                mapping.setdefault(idx, "neutral")
        else:
            for idx in centroids.index:
                mapping[idx] = REGIME_LABELS[idx % len(REGIME_LABELS)]
        return mapping

    @staticmethod
    def _distance_to_confidence(distances: np.ndarray) -> float:
        """Converts cluster-distance vector into a [0, 1] confidence score:
        1.0 = tightly assigned to nearest centroid relative to the others.
        """
        sorted_d = np.sort(distances)
        nearest, second_nearest = sorted_d[0], sorted_d[1]
        if second_nearest == 0:
            return 0.0
        return float(1.0 - (nearest / second_nearest))
