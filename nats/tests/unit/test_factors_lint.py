"""Runs the anti-lookahead lint check (spec UPGRADE 2) as a pytest gate."""

from src.factors.lint_check import run


def test_no_lookahead_violations():
    violations = run()
    assert violations == [], f"Anti-lookahead violations found: {violations}"
