#!/usr/bin/env bash
# One-command $0.001 x402 snack pay + fetch (requires `acp` wallet on PATH)
set -euo pipefail
export PATH="${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"
export TS_KEYRING_BACKEND="${TS_KEYRING_BACKEND:-file}"

SNACK="${1:-gas}"
USDC="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"

case "$SNACK" in
  gas) URL="https://acp-x402-scriptmasterlabs.onrender.com/x402/gas-tracker" ;;
  price|crypto) URL="https://mcp-x402.onrender.com/x402/crypto-price?ids=bitcoin" ;;
  grants) URL="https://mcp-x402.onrender.com/x402/grants?keyword=housing" ;;
  funding) URL="https://acp-x402-scriptmasterlabs.onrender.com/x402/funding-rates?symbol=BTCUSDT" ;;
  rwa) URL="https://sml-rwa-api.onrender.com/x402/rwa-valuation?asset_id=buidl" ;;
  *) echo "usage: $0 [gas|price|grants|funding|rwa]"; exit 2 ;;
esac

echo "[pay-snack] $SNACK → $URL"

CHAL=$(curl -sS "$URL" -H 'Accept: application/json' || true)
read -r PAY_TO AMOUNT < <(python3 -c "
import json,sys
raw=sys.stdin.read()
try:
 d=json.loads(raw)
 a=(d.get('accepts') or [{}])[0]
 print(a.get('payTo') or '', a.get('amount') or a.get('maxAmountRequired') or '1000')
except Exception:
 print('', '1000')
" <<<"$CHAL")

if [[ ! "${PAY_TO}" =~ ^0x[a-fA-F0-9]{40}$ ]]; then
  echo "[pay-snack] failed to parse payTo from 402"
  echo "$CHAL" | head -c 400
  exit 1
fi
echo "[pay-snack] payTo=$PAY_TO amount=$AMOUNT"

DATA=$(python3 -c "print('0xa9059cbb' + '${PAY_TO}'[2:].lower().zfill(64) + format(int('${AMOUNT}'),'x').zfill(64))")

if ! command -v acp >/dev/null 2>&1; then
  echo "[pay-snack] acp CLI not found — use browser wallet:"
  echo "  https://www.scriptmasterlabs.com/hermes-loop.html"
  exit 127
fi

TX_JSON=$(acp wallet send-transaction --chain-id 8453 --to "$USDC" --data "$DATA" --value 0 --json)
TX=$(python3 -c "import sys,re; m=re.search(r'0x[a-fA-F0-9]{64}', sys.stdin.read()); print(m.group(0) if m else '')" <<<"$TX_JSON")
if [[ -z "$TX" ]]; then
  echo "[pay-snack] no tx hash: $TX_JSON"; exit 1
fi
echo "[pay-snack] tx=$TX"
sleep 4
echo "[pay-snack] fetching paid data…"
curl -sS "$URL" -H "X-PAYMENT-TX: $TX" -H "Accept: application/json"
echo
echo "[pay-snack] RECEIPT"
echo "  tool:    $SNACK"
echo "  amount:  \$0.001 USDC"
echo "  tx:      $TX"
echo "  explore: https://basescan.org/tx/$TX"
echo "  demo:    https://www.scriptmasterlabs.com/hermes-loop.html"
