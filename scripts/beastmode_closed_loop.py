#!/usr/bin/env python3
"""
Beastmode Closed-Loop Treasury Recycler
======================================
Payer:  ACP agent wallet 0x7233… (scriptmasterlabs) — has USDC
Recv:   Coinbase rails    0x7233…f4aa (mcp payTo) — SML treasury
        ACP self          0x7233… (ACP snacks only — sovereign self-pay OK)

Money never leaves SML-controlled wallets. Real Base USDC txs + real 200 redeems.
Facilitator X-PAYMENT attempted first on mcp (not self-send); falls back to X-PAYMENT-TX.
"""
from __future__ import annotations
import json, urllib.request, urllib.error, subprocess, time, sys, re, base64, secrets
from pathlib import Path

USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
ACP = "0x72330994f379a71542e7bd5a4cf99a9d9743f4aa"
RAILS = "0x72330994f379a71542e7bd5a4cf99a9d9743f4aa"
UNITS = 1000  # 0.001 USDC
OUT = Path("/workspace/sml-portfolio-temp/scripts/beastmode_results.json")
LOG = Path("/workspace/sml-portfolio-temp/scripts/beastmode.log")

# ONLY proven-working snacks (no CoinGecko/FRED key deps)
MCP = [
    f"https://mcp-x402.onrender.com/x402/fx-rate?base=USD&symbols=EUR&_n={i}"
    for i in range(3)
] + [
    "https://mcp-x402.onrender.com/x402/fx-rate?base=USD&symbols=JPY",
    "https://mcp-x402.onrender.com/x402/gas-tracker",
    "https://mcp-x402.onrender.com/x402/web-fetch?url=https://example.com",
    "https://mcp-x402.onrender.com/x402/news-headlines",
    "https://mcp-x402.onrender.com/x402/grants?keyword=ai",
    "https://mcp-x402.onrender.com/x402/treasury-yields",
    "https://mcp-x402.onrender.com/x402/pha-lookup",
    "https://mcp-x402.onrender.com/x402/hcv-fmr",
    "https://mcp-x402.onrender.com/x402/housing-windsor",
    "https://mcp-x402.onrender.com/x402/domain-enrich?domain=example.com",
    "https://mcp-x402.onrender.com/x402/sec-8k?ticker=AAPL",
    "https://mcp-x402.onrender.com/x402/market?naics=541512",
]
ACP_SNACKS = [
    "https://acp-x402-scriptmasterlabs.onrender.com/x402/gas-tracker",
    "https://acp-x402-scriptmasterlabs.onrender.com/x402/fear-greed-index",
    "https://acp-x402-scriptmasterlabs.onrender.com/x402/funding-rates",
    "https://acp-x402-scriptmasterlabs.onrender.com/x402/stablecoin-watch",
    "https://acp-x402-scriptmasterlabs.onrender.com/x402/defi-analytics",
]

RPCS = [
    "https://base-rpc.publicnode.com",
    "https://base.drpc.org",
    "https://mainnet.base.org",
    "https://base.gateway.tenderly.co",
]

def log(msg: str):
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    with LOG.open("a") as f:
        f.write(line + "\n")

def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    last = None
    for url in RPCS:
        try:
            req = urllib.request.Request(
                url, data=body,
                headers={"Content-Type": "application/json", "User-Agent": "SML-beastmode/1.0"},
            )
            return json.loads(urllib.request.urlopen(req, timeout=20).read().decode())
        except Exception as e:
            last = e
            continue
    raise RuntimeError(f"rpc fail {method}: {last}")

def usdc_bal(addr: str) -> float:
    data = "0x70a08231" + addr[2:].lower().zfill(64)
    r = rpc("eth_call", [{"to": USDC, "data": data}, "latest"])
    return int(r.get("result") or "0x0", 16) / 1e6

def send_usdc(to: str, units: int) -> str:
    data = "0xa9059cbb" + to[2:].lower().zfill(64) + hex(units)[2:].zfill(64)
    p = subprocess.run(
        ["acp", "wallet", "send-transaction", "--chain-id", "8453",
         "--to", USDC, "--data", data, "--value", "0", "--json"],
        capture_output=True, text=True, timeout=120,
    )
    out = (p.stdout or "") + (p.stderr or "")
    try:
        d = json.loads(p.stdout.strip() or "{}")
        h = d.get("transactionHash") or d.get("hash") or d.get("txHash")
        if h:
            return h if str(h).startswith("0x") else "0x" + h
    except Exception:
        pass
    m = re.search(r"0x[a-fA-F0-9]{64}", out)
    if m:
        return m.group(0)
    raise RuntimeError(f"send failed: {out[:400]}")

def wait_receipt(tx: str, tries: int = 15) -> bool:
    for _ in range(tries):
        try:
            r = rpc("eth_getTransactionReceipt", [tx])
            rec = r.get("result")
            if rec:
                st = str(rec.get("status", "")).lower()
                if st in ("0x1", "1", "0x01"):
                    return True
                if st in ("0x0", "0"):
                    return False
        except Exception:
            pass
        time.sleep(2.0)
    return True

def redeem(url: str, tx: str):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "SML-beastmode/1.0",
            "Accept": "application/json",
            "X-PAYMENT-TX": tx,
            "x-payment-tx": tx,
        },
    )
    try:
        r = urllib.request.urlopen(req, timeout=45)
        return r.status, r.read(400).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(400).decode("utf-8", "replace")
    except Exception as e:
        return 0, str(e)

def try_facilitator(url: str, pay_to: str, from_addr: str) -> tuple[bool, str]:
    """Try EIP-3009 X-PAYMENT once. Returns (ok, detail)."""
    if pay_to.lower() == from_addr.lower():
        return False, "skip_self_send_facilitator"
    # live amount
    try:
        urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "SML"}), timeout=20)
        amount = "1000"
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode())
            acc = (body.get("accepts") or [{}])[0]
            amount = str(acc.get("amount") or acc.get("maxAmountRequired") or "1000")
            pay_to = acc.get("payTo") or pay_to
        except Exception:
            amount = "1000"
    now = int(time.time())
    nonce = "0x" + secrets.token_hex(32)
    typed = {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            "TransferWithAuthorization": [
                {"name": "from", "type": "address"},
                {"name": "to", "type": "address"},
                {"name": "value", "type": "uint256"},
                {"name": "validAfter", "type": "uint256"},
                {"name": "validBefore", "type": "uint256"},
                {"name": "nonce", "type": "bytes32"},
            ],
        },
        "primaryType": "TransferWithAuthorization",
        "domain": {
            "name": "USD Coin",
            "version": "2",
            "chainId": 8453,
            "verifyingContract": USDC,
        },
        "message": {
            "from": from_addr,
            "to": pay_to,
            "value": amount,
            "validAfter": "0",
            "validBefore": str(now + 600),
            "nonce": nonce,
        },
    }
    p = subprocess.run(
        ["acp", "wallet", "sign-typed-data", "--chain-id", "8453", "--data", json.dumps(typed), "--json"],
        capture_output=True, text=True, timeout=90,
    )
    try:
        sig = json.loads(p.stdout).get("signature")
    except Exception:
        m = re.search(r"0x[a-fA-F0-9]{130}", (p.stdout or "") + (p.stderr or ""))
        sig = m.group(0) if m else None
    if not sig:
        return False, "no_sig"
    payload = {
        "x402Version": 2,
        "scheme": "exact",
        "network": "eip155:8453",
        "payload": {
            "signature": sig,
            "authorization": {
                "from": from_addr,
                "to": pay_to,
                "value": amount,
                "validAfter": "0",
                "validBefore": str(now + 600),
                "nonce": nonce,
            },
        },
    }
    b64 = base64.b64encode(json.dumps(payload).encode()).decode()
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "SML-beastmode/1.0",
            "Accept": "application/json",
            "X-PAYMENT": b64,
            "PAYMENT-SIGNATURE": b64,
        },
    )
    try:
        r = urllib.request.urlopen(req, timeout=60)
        return True, f"facilitator_200 {r.read(80).decode()[:80]}"
    except urllib.error.HTTPError as e:
        return False, f"facilitator_{e.code} {e.read(120).decode()[:120]}"
    except Exception as e:
        return False, str(e)

def main():
    leave = float(sys.argv[1]) if len(sys.argv) > 1 else 0.08
    # ensure agent
    subprocess.run(["acp", "agent", "use", "--agent-id", "019f5f40-c194-7776-b5e1-7a666ce631c0"],
                   capture_output=True, text=True)
    bal0 = usdc_bal(ACP)
    rails0 = usdc_bal(RAILS)
    log(f"START payer={ACP} USDC={bal0:.6f} rails={RAILS} USDC={rails0:.6f} leave={leave}")

    # build rotation: 80% mcp→rails, 20% acp self
    targets = []
    for u in MCP:
        targets.append((u, RAILS, "mcp→rails"))
    for u in ACP_SNACKS:
        targets.append((u, ACP, "acp→acp"))

    results = []
    ok = 0
    fac_ok = 0
    i = 0
    consecutive_fail = 0

    # one facilitator probe up front
    fac_ok_once, fac_detail = try_facilitator(MCP[0], RAILS, ACP)
    log(f"FACILITATOR_PROBE {fac_ok_once} {fac_detail}")
    use_fac = fac_ok_once

    while True:
        bal = usdc_bal(ACP)
        if bal < leave + 0.001:
            log(f"STOP balance {bal:.6f} <= leave+0.001")
            break
        url, pay_to, tag = targets[i % len(targets)]
        i += 1
        # strip cache-bust for display
        disp = url.split(".com")[-1].split("&_n=")[0][:55]

        # facilitator path if previously worked
        if use_fac and pay_to.lower() != ACP.lower():
            okf, det = try_facilitator(url.split("&_n=")[0] if "&_n=" in url else url, pay_to, ACP)
            if okf:
                ok += 1
                fac_ok += 1
                consecutive_fail = 0
                log(f"FAC_OK #{ok} {disp}")
                results.append({"rail": "facilitator", "url": url, "ok": True, "detail": det})
                time.sleep(0.5)
                continue
            else:
                use_fac = False  # stop wasting sigs
                log(f"FAC_DEAD {det[:100]} → sovereign")

        try:
            tx = send_usdc(pay_to, UNITS)
        except Exception as e:
            consecutive_fail += 1
            log(f"SEND_ERR {e}")
            results.append({"error": str(e), "url": url})
            if consecutive_fail >= 4:
                log("STOP repeated send failures")
                break
            time.sleep(3)
            continue

        log(f"PAY #{ok+1} {tag} tx={tx[:14]}… {disp}")
        time.sleep(2.5)
        wait_receipt(tx)
        code, body = 0, ""
        for attempt in range(6):
            code, body = redeem(url.split("&_n=")[0] if "&_n=" in url else url, tx)
            if code == 200:
                break
            if code in (502, 503) or "not_found" in body.lower() or "pending" in body.lower():
                time.sleep(2.5)
                continue
            break

        # 503 after pay = burned units to treasury still (closed loop) but not a product 200
        success = code == 200
        if success:
            ok += 1
            consecutive_fail = 0
            log(f"  REDEEM 200 ok={ok}")
        else:
            consecutive_fail += 1
            log(f"  REDEEM {code} {body[:100].replace(chr(10),' ')}")
            # still closed-loop treasury move if pay went to rails
        results.append({
            "rail": "sovereign", "url": url, "payTo": pay_to, "tx": tx,
            "code": code, "ok": success, "body": body[:200],
        })
        if consecutive_fail >= 8:
            log("STOP too many redeem fails")
            break
        time.sleep(0.6)

    bal1 = usdc_bal(ACP)
    rails1 = usdc_bal(RAILS)
    summary = {
        "ok_redeems": ok,
        "facilitator_ok": fac_ok,
        "attempts": len(results),
        "acp_usdc_before": bal0,
        "acp_usdc_after": bal1,
        "rails_usdc_before": rails0,
        "rails_usdc_after": rails1,
        "moved_to_rails_est": rails1 - rails0,
        "spent_from_acp": bal0 - bal1,
        "wallets": {"payer_acp": ACP, "treasury_rails": RAILS},
        "note": "Closed-loop: USDC stays in SML (ACP↔rails). Wrong XRPL rNdu… not used.",
    }
    OUT.write_text(json.dumps({"summary": summary, "results": results}, indent=2))
    log(f"DONE {json.dumps(summary)}")
    log(f"saved {OUT}")
    return 0 if ok else 1

if __name__ == "__main__":
    sys.exit(main())
