#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# SOVEREIGN DATA ENFORCEMENT — ScriptMasterLabs
#
# Scans frontend source files for any pattern that indicates synthetic, fake,
# demo, placeholder, or hardcoded data being presented to users.
#
# EXIT 1 if violations found — blocks commit and CI.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

VIOLATIONS=0
SCAN_DIRS=("src" "public" "pages" "components" "app")
EXTENSIONS=("ts" "tsx" "js" "jsx" "html")

FILES=()
for dir in "${SCAN_DIRS[@]}"; do
  [[ -d "$dir" ]] || continue
  for ext in "${EXTENSIONS[@]}"; do
    while IFS= read -r f; do
      FILES+=("$f")
    done < <(find "$dir" -name "*.${ext}" 2>/dev/null)
  done
done

# Also scan root-level HTML files
while IFS= read -r f; do
  FILES+=("$f")
done < <(find . -maxdepth 1 -name "*.html" 2>/dev/null)

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "No frontend source files found — skipping sovereign data check."
  exit 0
fi

PATTERNS=(
  # Hardcoded fake trading data in frontend
  "(mock|fake|demo|placeholder|simul|synthetic|dummy)[Dd]ata"
  # Hardcoded price/signal strings in JS/TS source
  "confidence:[[:space:]]*0\.[0-9]{2,}"
  # Fake agent names
  "QUANT_ALPHA|RISK_SENTINEL|MACRO_ORACLE|SENTIMENT_AI|CHAIN_ANALYST|VOLUME_HAWK|BREAKOUT_BOT"
  # TODO markers for replacing fake data
  "TODO.*replace.*live|TODO.*real.*data|TODO.*upstream|FIXME.*mock|FIXME.*fake"
  # Demo mode flags
  "DEMO_MODE|isDemoMode|isMockMode|IS_MOCK|USE_MOCK"
  # Hardcoded RLUSD/XRP amounts as fake signals
  "entry:[[:space:]]*0\.[0-9]+.*target[12]:"
)

echo "──────────────────────────────────────────────────────────────────────"
echo "  SOVEREIGN DATA ENFORCEMENT SCAN"
echo "  Repo: $(basename "$PWD")  |  Files: ${#FILES[@]}"
echo "──────────────────────────────────────────────────────────────────────"

for file in "${FILES[@]}"; do
  for pattern in "${PATTERNS[@]}"; do
    matches=$(grep -nE "$pattern" "$file" 2>/dev/null || true)
    if [[ -n "$matches" ]]; then
      echo -e "${RED}VIOLATION${NC} in ${YELLOW}${file}${NC}:"
      while IFS= read -r line; do
        echo "  $line"
      done <<< "$matches"
      echo ""
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  done
done

echo "──────────────────────────────────────────────────────────────────────"
if [[ $VIOLATIONS -gt 0 ]]; then
  echo -e "${RED}BLOCKED: ${VIOLATIONS} sovereign data violation(s) detected.${NC}"
  echo ""
  echo "  All displayed data MUST originate from live API endpoints."
  echo "  No hardcoded signals, prices, or fabricated data in the frontend — ever."
  echo ""
  echo "  Fix violations before committing."
  exit 1
else
  echo "  PASS — no sovereign data violations found."
  exit 0
fi
