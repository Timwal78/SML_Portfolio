#!/usr/bin/env bash
# x402 daily seed — keep recipient tape warm @ $0.001 sovereign rail
# Cron-safe: hardcoded PATH/HOME, explicit acp, no interactive prompts.
set -euo pipefail
export HOME="${HOME:-/home/hermes}"
export PATH="/home/hermes/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export PATH="$HOME/.hermes/bin:$PATH"

LOG_DIR="${HERMES_HOME:-$HOME/.hermes}/cron/output"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/x402_daily_seed_$(date -u +%Y%m%dT%H%M%SZ).log"
exec > >(tee -a "$LOG") 2>&1

echo "[seed] start $(date -u +%Y-%m-%dT%H:%M:%SZ)"

if ! command -v acp >/dev/null 2>&1; then
  echo "[seed] FATAL: acp not on PATH"; exit 127
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "[seed] FATAL: python3 missing"; exit 127
fi

python3 << 'PY'
import json, subprocess, urllib.request, urllib.error, time, os, sys

USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
MCP = "0x72330994f379a71542e7bd5a4cf99a9d9743f4aa"
ACP = "0x72330994f379a71542e7bd5a4cf99a9d9743f4aa"

# Rotate daily across wedge routes (cheap + high-signal)
JOBS = [
    (MCP, "https://mcp-x402.onrender.com/x402/attention/bounties?status=open"),
    (MCP, "https://mcp-x402.onrender.com/x402/novel/catalog"),
    (MCP, "https://mcp-x402.onrender.com/x402/sleep/dreams?agent_id=daily-seed"),

    (MCP, "https://mcp-x402.onrender.com/x402/crypto-price?ids=bitcoin"),
    (MCP, "https://mcp-x402.onrender.com/x402/fx-rate?base=USD&symbols=EUR"),
    (MCP, "https://mcp-x402.onrender.com/x402/grants?keyword=ai"),
    (ACP, "https://acp-x402-scriptmasterlabs.onrender.com/x402/gas-tracker"),
    (ACP, "https://acp-x402-scriptmasterlabs.onrender.com/x402/crypto-news?limit=2"),
    (ACP, "https://acp-x402-scriptmasterlabs.onrender.com/x402/funding-rates?symbol=BTCUSDT"),
    (ACP, "https://sml-rwa-api.onrender.com/x402/rwa-valuation?asset_id=buidl"),
    (ACP, "https://sml-rwa-api.onrender.com/x402/rwa-risk?asset_id=buidl"),
]

def bal_usdc():
    d = json.loads(subprocess.check_output(["acp", "wallet", "balance", "--json"], text=True))
    for t in d.get("tokens") or []:
        if t.get("network") != "base-mainnet":
            continue
        addr = (t.get("tokenAddress") or "").lower()
        if addr.startswith("0x8335"):
            return int(t.get("tokenBalance") or "0x0", 16) / 1e6
    return 0.0

def xfer(pay_to: str, amount: int = 1000) -> str:
    data = "0xa9059cbb" + pay_to[2:].lower().zfill(64) + hex(amount)[2:].zfill(64)
    raw = subprocess.check_output(
        ["acp", "wallet", "send-transaction", "--chain-id", "8453",
         "--to", USDC, "--data", data, "--value", "0", "--json"],
        text=True,
    )
    d = json.loads(raw)
    return d.get("transactionHash") or d.get("hash") or ""

def redeem(url: str, tx: str) -> int:
    req = urllib.request.Request(url, headers={"X-PAYMENT-TX": tx, "Accept": "application/json", "User-Agent": "sml-x402-daily-seed/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=50) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0

usdc = bal_usdc()
print(f"[seed] USDC={usdc:.4f}")
# need ~0.01 USDC headroom (8 * 0.001 + fees buffer)
if usdc < 0.02:
    print("[seed] SKIP low USDC — top up Base USDC")
    sys.exit(0)

ok = 0
for pay, url in JOBS:
    try:
        tx = xfer(pay)
        print(f"[seed] tx={tx[:18]}… {url.split('.com')[-1][:48]}")
        time.sleep(2.8)
        code = 0
        for _ in range(5):
            code = redeem(url, tx)
            if code == 200:
                break
            time.sleep(1.5)
        print(f"[seed]  http={code}")
        if code == 200:
            ok += 1
    except Exception as e:
        print(f"[seed] FAIL {e}")
    time.sleep(0.4)

print(f"[seed] done ok={ok}/{len(JOBS)} usdc_left={bal_usdc():.4f}")
# non-zero only on total failure
sys.exit(0 if ok > 0 else 1)
PY

echo "[seed] end $(date -u +%Y-%m-%dT%H:%M:%SZ)"
