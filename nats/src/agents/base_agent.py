"""Base interface all 20 NATS agents implement.

Every agent is stateless and independently testable: given a factor frame
for a single symbol (or symbol universe, for cross-asset/pairs agents), it
returns a signal in {-1, 0, +1} per bar. Agents must never look ahead —
all factors consumed here are expected to already be `.shift(1)`'d by the
factors/ pipeline before reaching `generate_signal`.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

import pandas as pd


@dataclass(frozen=True)
class AgentMetadata:
    agent_id: int
    name: str
    thesis: str
    edge: str
    factors: list[str] = field(default_factory=list)
    data_sources: list[str] = field(default_factory=list)
    long_only: bool = False


class BaseAgent(ABC):
    """Common contract for all NATS agents.

    Subclasses set `metadata` and implement `generate_signal`.
    """

    metadata: AgentMetadata

    @abstractmethod
    def generate_signal(self, factor_frame: pd.DataFrame) -> pd.Series:
        """Return a Series of {-1, 0, +1} (or {0, +1} if long_only) aligned
        to `factor_frame.index`. `factor_frame` must contain only
        already-shifted factor columns — no raw price/volume lookahead.
        """
        raise NotImplementedError

    def validate_output(self, signal: pd.Series) -> None:
        allowed = {0, 1} if self.metadata.long_only else {-1, 0, 1}
        bad = set(signal.dropna().unique()) - allowed
        if bad:
            raise ValueError(
                f"{self.metadata.name} emitted signal values outside {allowed}: {bad}"
            )
