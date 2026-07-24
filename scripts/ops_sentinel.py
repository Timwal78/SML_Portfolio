#!/usr/bin/env python3
"""
Ops Sentinel — autonomous operational-drift fixer for SML_Portfolio.

OPERATOR MANDATE (2026-07-24): full autonomy for OPERATIONAL fixes only —
no human approval gate. Money and credentials (Stripe products/pricing,
AWS/API keys, ACP wallet/signer config) are explicitly OUT OF SCOPE for
this script and must never be touched here. That boundary is load-bearing,
not a style choice — see this repo's own "zero custody" decisions
throughout its history, and the fact that a separate autonomous agent
(scriptmasterlabs@agent.virtuals.io) already owns the ACP wallet/signer
code — this script must never race it.

NO GUESSING OR ASSUMING — this is the other hard rule this script exists
to enforce on itself:
  - Every auto-applied fix must be a mechanical transformation derived
    from a concrete, re-derivable source of truth in this repo (e.g. the
    literal count of `server.tool(` registrations across
    mcp-x402/src/server/tools/*.ts). No fix here is generated freeform,
    by an LLM, or by inference.
  - The MCP registry enforces a hard 100-char limit on server.json's
    description field (discovered the hard way in this session — two
    publish attempts failed a 422 before this was caught). If applying a
    tool-count fix would push a description over 100 chars, this script
    refuses to write it and flags it instead — it will never silently
    produce a file that fails registry validation.
  - Orphaned pages (a real .html file not linked from index.html) are
    ALWAYS flagged, never auto-linked. Deciding whether an orphaned page
    is a real, live, worth-surfacing product (like cascade.html turned
    out to be) or genuinely not ready requires verifying a real backend
    exists — that's judgment, not a mechanical check, and this script
    must not guess at it.
  - If a source file can't be parsed/read, the check for it is skipped
    and logged as skipped — never treated as "0" or "no drift found".

Run: python3 scripts/ops_sentinel.py [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MCP_X402_ROOT = REPO_ROOT / "mcp-x402"
TOOLS_DIR = MCP_X402_ROOT / "src" / "server" / "tools"
SERVER_JSON_PATH = MCP_X402_ROOT / "server.json"
SERVER_JSON_DESC_LIMIT = 100

TOOL_COUNT_FILES = [
    REPO_ROOT / "ai.txt",
    REPO_ROOT / "llms.txt",
    # .well-known/ai.txt deliberately excluded: it's a multi-product file
    # (TrustVerify AI / Agent Credit Bureau / SqueezeOS / mcp-x402 each get
    # their own "Product:" block) and SqueezeOS's block happens to use the
    # exact "N-tool" hyphenated phrasing this script auto-fixes for
    # mcp-x402 — caught this during testing before it shipped a fix that
    # would have overwritten SqueezeOS's real tool count with mcp-x402's.
    REPO_ROOT / "index.html",
    REPO_ROOT / "agent-wallet.html",
    MCP_X402_ROOT / "package.json",
    MCP_X402_ROOT / "README.md",
    MCP_X402_ROOT / "agents.json",
    MCP_X402_ROOT / "llms.txt",
    MCP_X402_ROOT / "src" / "server" / "index.ts",
    MCP_X402_ROOT / "src" / "server" / "tools" / "discovery.ts",
]

# Unambiguous compound phrasings only — see module docstring. A bare "N
# tools" is handled separately and only ever flagged, never auto-fixed.
TOOL_COUNT_PATTERNS = [
    re.compile(r"(?P<num>\d+)(?P<suffix>\+?\s*(?:pay-per-call )?MCP tools)"),
    re.compile(r"(?P<num>\d+)(?P<suffix>\+?[- ]tool(?:s)? (?:server|available))"),
    re.compile(r"(?P<num>\d+)(?P<suffix>-tool\b)"),
]
TOOL_COUNT_FLAG_PATTERN = re.compile(r"(?<!MCP )(?<!-)\b(\d+)\+?\s+tools\b")

MARKETING_ACTIVITY_URL = os.environ.get(
    "MARKETING_ACTIVITY_URL", "https://squeezeos-api.onrender.com/api/marketing/activity"
)
MARKETING_ACTIVITY_SECRET = os.environ.get("MARKETING_ACTIVITY_SECRET", "")


def get_real_mcp_x402_tool_count() -> int | None:
    """Mechanically counts server.tool( registrations across every file in
    mcp-x402/src/server/tools/. Returns None (never a guessed number) if
    the directory can't be read."""
    if not TOOLS_DIR.is_dir():
        print(f"[skip] {TOOLS_DIR} not found")
        return None

    names: set[str] = set()
    for ts_file in TOOLS_DIR.glob("*.ts"):
        try:
            text = ts_file.read_text()
        except OSError as e:
            print(f"[skip] cannot read {ts_file}: {e}")
            continue
        for m in re.finditer(r"server\.tool\(\s*\n?\s*['\"]([a-zA-Z0-9_]+)['\"]", text):
            names.add(m.group(1))

    if not names:
        print("[skip] zero server.tool( registrations found — refusing to trust this")
        return None
    return len(names)


def fix_tool_count_mentions(real_count: int, dry_run: bool) -> tuple[list[str], list[str]]:
    """Returns (applied_fixes, refused_fixes). A fix is refused (not
    applied) rather than silently applied if it would push server.json's
    description over the registry's 100-char limit."""
    fixes: list[str] = []
    refused: list[str] = []

    for path in TOOL_COUNT_FILES:
        if not path.exists():
            continue
        try:
            text = path.read_text()
        except OSError as e:
            print(f"[skip] cannot read {path}: {e}")
            continue

        new_text = text
        for pattern in TOOL_COUNT_PATTERNS:
            def _replace(m: re.Match) -> str:
                stated = int(m.group("num"))
                if stated == real_count:
                    return m.group(0)
                fixes.append(f"{path.relative_to(REPO_ROOT)}: {stated} -> {real_count}{m.group('suffix')}")
                return f"{real_count}{m.group('suffix')}"

            new_text = pattern.sub(_replace, new_text)

        if new_text != text:
            if path == SERVER_JSON_PATH:
                # Guard against re-breaking the exact bug from earlier today:
                # never write a server.json whose description exceeds the
                # registry's hard 100-char limit.
                try:
                    data = json.loads(new_text)
                    desc = data.get("description", "")
                except json.JSONDecodeError:
                    desc = None
                if desc is not None and len(desc) > SERVER_JSON_DESC_LIMIT:
                    refused.append(
                        f"{path.relative_to(REPO_ROOT)}: tool-count fix would make description "
                        f"{len(desc)} chars (limit {SERVER_JSON_DESC_LIMIT}) — refusing to write, flagging instead"
                    )
                    continue
            if not dry_run:
                path.write_text(new_text)

    return fixes, refused


def flag_ambiguous_tool_count_mentions(real_count: int) -> list[str]:
    flags = []
    for path in TOOL_COUNT_FILES:
        if not path.exists():
            continue
        try:
            text = path.read_text()
        except OSError:
            continue
        for m in TOOL_COUNT_FLAG_PATTERN.finditer(text):
            stated = int(m.group(1))
            if stated != real_count:
                line_no = text.count("\n", 0, m.start()) + 1
                flags.append(
                    f"{path.relative_to(REPO_ROOT)}:{line_no} says \"{stated} tools\" "
                    f"(real mcp-x402 total is {real_count}) — needs a human to confirm"
                )
    return flags


def flag_broken_internal_links() -> list[str]:
    """Tier 2 — flag only. This is the exact check that would have caught
    the mastersheets.html/smlsheets.html 404 automatically."""
    flags = []
    href_pattern = re.compile(r'href="/?([a-zA-Z0-9_\-./]+\.html)"')
    jsonld_pattern = re.compile(r'"url":\s*"https://[^"]*?/([a-zA-Z0-9_\-]+\.html)"')

    for html_file in REPO_ROOT.glob("*.html"):
        try:
            text = html_file.read_text()
        except OSError:
            continue
        for pattern in (href_pattern, jsonld_pattern):
            for m in pattern.finditer(text):
                target = m.group(1)
                target_path = (REPO_ROOT / target).resolve()
                if not target_path.exists():
                    flags.append(f"{html_file.name} references missing {target}")

    return sorted(set(flags))


def flag_orphaned_pages() -> list[str]:
    """Tier 2 — flag only. Whether an orphaned page is a real product worth
    linking (like cascade.html) or not-ready requires verifying a real
    backend exists behind it, which is judgment this script must not
    perform on its own."""
    index_path = REPO_ROOT / "index.html"
    if not index_path.exists():
        return []
    try:
        index_text = index_path.read_text()
    except OSError:
        return []

    linked = set(re.findall(r'href="/?([a-zA-Z0-9_\-]+\.html)"', index_text))
    all_pages = {p.name for p in REPO_ROOT.glob("*.html")}
    orphaned = sorted(all_pages - linked - {"index.html"})
    if not orphaned:
        return []
    return [f"{len(orphaned)} page(s) not linked from index.html (needs human verification, not auto-linked): "
            + ", ".join(orphaned[:15]) + (" ..." if len(orphaned) > 15 else "")]


def report_to_activity_feed(agent: str, action: str, status: str) -> None:
    if not MARKETING_ACTIVITY_SECRET:
        print(f"[activity-feed skipped: no secret configured] {agent}: {action}")
        return
    body = json.dumps({"agent": agent, "action": action, "status": status}).encode()
    req = urllib.request.Request(
        MARKETING_ACTIVITY_URL,
        data=body,
        headers={"Content-Type": "application/json", "X-Marketing-Secret": MARKETING_ACTIVITY_SECRET},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=15)
    except Exception as e:  # noqa: BLE001 - reporting is best-effort, never fatal
        print(f"[activity-feed post failed] {e}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    real_count = get_real_mcp_x402_tool_count()

    fixes: list[str] = []
    refused: list[str] = []
    if real_count is not None:
        fixes, refused = fix_tool_count_mentions(real_count, args.dry_run)
    else:
        print("[skip] tool-count checks skipped entirely — could not establish real count")

    flags = flag_broken_internal_links()
    flags += flag_orphaned_pages()
    if real_count is not None:
        flags += flag_ambiguous_tool_count_mentions(real_count)
    flags += refused

    if fixes:
        verb = "would be applied" if args.dry_run else "applied"
        print(f"\n{len(fixes)} fix(es) {verb}:")
        for f in fixes:
            print(f"  - {f}")
        report_to_activity_feed(
            "Ops Sentinel",
            f"Auto-fixed {len(fixes)} operational drift issue(s) in SML_Portfolio: " + "; ".join(fixes[:5])
            + (" ..." if len(fixes) > 5 else ""),
            "success",
        )
    else:
        print("\nNo mechanically-fixable drift found.")

    if flags:
        print(f"\n{len(flags)} item(s) flagged for human review (not auto-fixed):")
        for f in flags:
            print(f"  - {f}")
        report_to_activity_feed(
            "Ops Sentinel",
            f"Flagged {len(flags)} issue(s) needing human judgment in SML_Portfolio: " + "; ".join(flags[:5])
            + (" ..." if len(flags) > 5 else ""),
            "info",
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
