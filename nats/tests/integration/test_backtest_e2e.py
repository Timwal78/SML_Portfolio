"""End-to-end backtest integration test.

Once Phase 2 wires real agent logic + `scripts/backtest.py`, this test
should run a short synthetic backtest window and assert:
  - every agent emits only {-1, 0, +1} (or {0, 1} for ShadowFlowHunter)
  - the ensemble applies weight floors/caps correctly
  - PSR/DSR/regime-coverage validation gates are computed and logged
  - the audit trail (JSONL) contains one entry per signal and trade

Currently skipped — `scripts/backtest.py` is a scaffold stub.
"""

import pytest


@pytest.mark.skip(reason="scripts/backtest.py is a scaffold stub — implement during Phase 2")
def test_full_backtest_runs_without_lookahead_violations():
    raise NotImplementedError
