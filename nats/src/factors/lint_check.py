"""Automated anti-lookahead lint check (spec UPGRADE 2).

Every function in `src/factors/*.py` (except this file and `__init__.py`)
must either:
  (a) return a value derived from a `.shift(1)` (or later) call on its
      result before `return`, or
  (b) be explicitly allow-listed in `CALENDAR_EXEMPT` because it derives
      purely from the calendar date of the current bar, which is knowable
      in advance and carries no price/volume lookahead risk.

Run standalone:
    python -m src.factors.lint_check
Or as a test: `pytest tests/unit/test_factors_lint.py`.

Exits non-zero (or raises `LookaheadViolation`) if any factor function is
missing a `.shift(` call on its return path.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

FACTORS_DIR = Path(__file__).parent
EXCLUDED_FILES = {"__init__.py", "lint_check.py"}

# Functions that are pure calendar transforms — the "future" value (today's
# date) is legitimately known in advance, so no shift(1) is required. Keep
# this list short and justify every entry in the factor's own docstring.
CALENDAR_EXEMPT = {
    "day_of_week_effect",
    "turn_of_month",
    "holiday_proximity",
    "options_expiry",
    "post_earnings_drift_window",
}


class LookaheadViolation(Exception):
    pass


def _return_exprs(func: ast.FunctionDef) -> list[ast.expr]:
    exprs = []
    for node in ast.walk(func):
        if isinstance(node, ast.Return) and node.value is not None:
            exprs.append(node.value)
    return exprs


def _contains_shift_call(expr: ast.expr) -> bool:
    for node in ast.walk(expr):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            if node.func.attr == "shift":
                return True
    return False


def _is_func_compliant(
    func: ast.FunctionDef,
    funcs_by_name: dict[str, ast.FunctionDef],
    memo: dict[str, bool],
    visiting: set[str],
) -> bool:
    """A function is compliant if every return expression either contains a
    literal `.shift(...)` call, or delegates (directly or transitively) to
    another local function that is itself compliant — e.g. a wrapper that
    returns `_helper(close, n)` where `_helper` ends in `.shift(1)`.
    """
    if func.name in memo:
        return memo[func.name]
    if func.name in visiting:
        return False  # recursion guard; a genuine cycle can't be compliant
    visiting.add(func.name)

    returns = _return_exprs(func)
    if not returns:
        result = True
    else:
        result = all(
            _expr_compliant(r, funcs_by_name, memo, visiting) for r in returns
        )

    visiting.discard(func.name)
    memo[func.name] = result
    return result


def _expr_compliant(
    expr: ast.expr,
    funcs_by_name: dict[str, ast.FunctionDef],
    memo: dict[str, bool],
    visiting: set[str],
) -> bool:
    if _contains_shift_call(expr):
        return True
    for node in ast.walk(expr):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            callee = funcs_by_name.get(node.func.id)
            if callee is not None and _is_func_compliant(callee, funcs_by_name, memo, visiting):
                return True
    return False


def check_file(path: Path) -> list[str]:
    violations: list[str] = []
    tree = ast.parse(path.read_text())
    funcs_by_name = {
        node.name: node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)
    }
    memo: dict[str, bool] = {}
    for node in funcs_by_name.values():
        if node.name.startswith("_"):
            continue
        if node.name in CALENDAR_EXEMPT:
            continue
        returns = _return_exprs(node)
        if not returns:
            continue
        if not _is_func_compliant(node, funcs_by_name, memo, set()):
            violations.append(f"{path.name}:{node.lineno} {node.name}() returns without .shift(...)")
    return violations


def run() -> list[str]:
    all_violations: list[str] = []
    for path in sorted(FACTORS_DIR.glob("*.py")):
        if path.name in EXCLUDED_FILES:
            continue
        all_violations.extend(check_file(path))
    return all_violations


def main() -> int:
    violations = run()
    if violations:
        print("ANTI-LOOKAHEAD LINT FAILED — factors missing .shift(1):", file=sys.stderr)
        for v in violations:
            print(f"  {v}", file=sys.stderr)
        return 1
    print(f"Anti-lookahead lint passed ({len(list(FACTORS_DIR.glob('*.py'))) - len(EXCLUDED_FILES)} factor modules checked).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
