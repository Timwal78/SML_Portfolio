"""Orchestration glue between data/factors/agents/ensemble/risk/execution
for the runnable scripts in scripts/. Kept separate from src/agents,
src/factors, etc. because it composes them rather than implementing a
single spec module.
"""

from src.pipeline.factor_builder import build_factor_frame

__all__ = ["build_factor_frame"]
