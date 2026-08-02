#!/usr/bin/env python3
"""Sovereign X-PAYMENT-TX seed bot — meticulous, one unique tx per settle."""
import json, urllib.request, urllib.error, subprocess, time, sys, re

USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
amount_units = 1000  # 0.001 USDC

# (url_with_query, payTo)
TARGETS = [
  # Unified payTo ACP wallet 0x7233 — Base USDC sovereign X-PAYMENT-TX
  ('https://mcp-x402.onrender.com/x402/grants?keyword=veteran', '0x72330994f379a71542e7bd5a4cf99a9d9743f4aa'),
  ('https://mcp-x402.onrender.com/x402/novel/catalog', '0x72330994f379a71542e7bd5a4cf99a9d9743f4aa'),
  ('https://mcp-x402.onrender.com/x402/sleep/dreams?agent_id=canary', '0x72330994f379a71542e7bd5a4cf99a9d9743f4aa'),
  ('https://mcp-x402.onrender.com/x402/afx/quote?product=attention_block', '0x72330994f379a71542e7bd5a4cf99a9d9743f4aa'),
  ('https://mcp-x402.onrender.com/x402/attention/bounties?status=open', '0x72330994f379a71542e7bd5a4cf99a9d9743f4aa'),
  ('https://mcp-x402.onrender.com/x402/fx-rate?base=USD&symbols=EUR', '0x72330994f379a71542e7bd5a4cf99a9d9743f4aa'),
  ('https://acp-x402-scriptmasterlabs.onrender.com/x402/gas-tracker', '0x72330994f379a71542e7bd5a4cf99a9d9743f4aa'),
  ('https://acp-x402-scriptmasterlabs.onrender.com/x402/fear-greed-index', '0x72330994f379a71542e7bd5a4cf99a9d9743f4aa'),
]

def usdc_transfer_data(to: str, units: int) -> str:
  return '0xa9059cbb' + to[2:].lower().zfill(64) + hex(units)[2:].zfill(64)

def send_usdc(to: str, units: int) -> str:
  data = usdc_transfer_data(to, units)
  p = subprocess.run(
    ['acp', 'wallet', 'send-transaction', '--chain-id', '8453',
     '--to', USDC, '--data', data, '--value', '0', '--json'],
    capture_output=True, text=True, timeout=120,
  )
  out = (p.stdout or '') + (p.stderr or '')
  try:
    d = json.loads(p.stdout.strip() or '{}')
    h = d.get('transactionHash') or d.get('hash') or d.get('txHash') or (d.get('data') or {}).get('transactionHash')
    if h:
      return h if str(h).startswith('0x') else '0x' + h
  except Exception:
    pass
  m = re.search(r'0x[a-fA-F0-9]{64}', out)
  if m:
    return m.group(0)
  raise RuntimeError(f'send failed rc={p.returncode}: {out[:500]}')

def wait_receipt(tx: str, tries=12):
  body_tmpl = {"jsonrpc": "2.0", "id": 1, "method": "eth_getTransactionReceipt", "params": [tx]}
  for i in range(tries):
    req = urllib.request.Request(
      'https://mainnet.base.org',
      data=json.dumps(body_tmpl).encode(),
      headers={'Content-Type': 'application/json', 'User-Agent': 'SML-seed/1.0'},
    )
    try:
      r = json.loads(urllib.request.urlopen(req, timeout=20).read().decode())
      rec = r.get('result')
      if rec and str(rec.get('status', '')).lower() in ('0x1', '1', '0x01'):
        return True
      if rec and str(rec.get('status', '')).lower() in ('0x0', '0'):
        return False
    except Exception:
      pass
    time.sleep(2.5)
  return True  # try redeem anyway

def redeem(url: str, tx: str):
  req = urllib.request.Request(
    url,
    headers={
      'User-Agent': 'SML-seed/1.0',
      'Accept': 'application/json',
      'X-PAYMENT-TX': tx,
      'x-payment-tx': tx,
    },
  )
  try:
    r = urllib.request.urlopen(req, timeout=45)
    body = r.read(500).decode('utf-8', 'replace')
    return r.status, body
  except urllib.error.HTTPError as e:
    body = e.read(500).decode('utf-8', 'replace')
    return e.code, body

def usdc_balance(addr: str) -> float:
  data = '0x70a08231' + addr[2:].lower().zfill(64)
  body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_call",
                     "params": [{"to": USDC, "data": data}, "latest"]}).encode()
  for rpc in ['https://mainnet.base.org','https://base-rpc.publicnode.com','https://base.drpc.org']:
    try:
      req = urllib.request.Request(rpc, data=body,
                                   headers={'Content-Type': 'application/json', 'User-Agent': 'SML-seed/1.0'})
      r = json.loads(urllib.request.urlopen(req, timeout=20).read().decode())
      return int(r.get('result') or '0x0', 16) / 1e6
    except Exception:
      continue
  return 0.0

def main():
  max_pays = int(sys.argv[1]) if len(sys.argv) > 1 else 80
  leave = float(sys.argv[2]) if len(sys.argv) > 2 else 0.25  # keep buffer USDC
  payer = subprocess.check_output(['acp', 'wallet', 'address'], text=True)
  m = re.search(r'0x[a-fA-F0-9]{40}', payer)
  payer_addr = m.group(0) if m else '0x72330994f379a71542e7bd5a4cf99a9d9743f4aa'
  bal0 = usdc_balance(payer_addr)
  print(f'payer={payer_addr} USDC={bal0:.6f} max_pays={max_pays} leave={leave}', flush=True)

  results = []
  ok = 0
  i = 0
  while ok < max_pays:
    url, pay_to = TARGETS[i % len(TARGETS)]
    i += 1
    bal = usdc_balance(payer_addr)
    if bal < leave + 0.001:
      print(f'STOP low balance {bal:.6f}', flush=True)
      break
    try:
      tx = send_usdc(pay_to, amount_units)
      print(f'PAY {ok+1} tx={tx[:12]}… → {pay_to[:8]}… {url.split(".com")[-1][:50]}', flush=True)
      time.sleep(3.0)
      wait_receipt(tx)
      # redeem with retries
      code, body = None, ''
      for attempt in range(5):
        code, body = redeem(url, tx)
        if code == 200:
          break
        if 'not_found' in body.lower() or 'pending' in body.lower():
          time.sleep(2.5)
          continue
        break
      success = code == 200
      if success:
        ok += 1
      print(f'  redeem {code} {body[:120].replace(chr(10), " ")}', flush=True)
      results.append({'url': url, 'payTo': pay_to, 'tx': tx, 'code': code, 'ok': success, 'body': body[:300]})
    except Exception as e:
      print(f'  ERR {e}', flush=True)
      results.append({'url': url, 'error': str(e)})
      time.sleep(2)
      # if send keeps failing, stop
      if 'send failed' in str(e) and results and sum(1 for r in results[-3:] if r.get('error')) >= 3:
        print('STOP repeated send failures', flush=True)
        break
    time.sleep(0.8)

  bal1 = usdc_balance(payer_addr)
  summary = {'ok': ok, 'attempts': len(results), 'usdc_before': bal0, 'usdc_after': bal1, 'spent': bal0 - bal1}
  open('/workspace/sml-portfolio-temp/scripts/x402_seed_results.json', 'w').write(json.dumps({'summary': summary, 'results': results}, indent=2))
  print('SUMMARY', json.dumps(summary), flush=True)
  print('saved /workspace/sml-portfolio-temp/scripts/x402_seed_results.json', flush=True)
  return 0 if ok else 1

if __name__ == '__main__':
  sys.exit(main())
