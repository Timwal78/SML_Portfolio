#!/usr/bin/env python3
"""Bulk SIWX register origins + snack URLs on x402scan."""
import json, base64, urllib.request, urllib.error, subprocess, re, time, sys
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import to_checksum_address

AGENT = '0x72330994f379a71542e7bd5a4cf99a9d9743f4aa'
AGENT_CS = to_checksum_address(AGENT)
BASE = 'https://www.x402scan.com'

ORIGINS = [
  'https://mcp-x402.onrender.com',
  'https://acp-x402-scriptmasterlabs.onrender.com',
  'https://sml-rwa-api.onrender.com',
  'https://squeezeos-api.onrender.com',
]
SNACKS = [
  'https://mcp-x402.onrender.com/x402/crypto-price',
  'https://mcp-x402.onrender.com/x402/fx-rate',
  'https://mcp-x402.onrender.com/x402/gas-tracker',
  'https://mcp-x402.onrender.com/x402/grants',
  'https://mcp-x402.onrender.com/x402/web-fetch',
  'https://mcp-x402.onrender.com/x402/news-headlines',
  'https://acp-x402-scriptmasterlabs.onrender.com/x402/crypto-price',
  'https://acp-x402-scriptmasterlabs.onrender.com/x402/gas-tracker',
  'https://sml-rwa-api.onrender.com/x402/rwa-valuation',
]

def http(method, url, body=None, headers=None):
  h = {'User-Agent': 'SML-x402scan-Bot/1.0', 'Accept': 'application/json', 'Content-Type': 'application/json'}
  if headers: h.update(headers)
  data = None if body is None else json.dumps(body).encode()
  req = urllib.request.Request(url, data=data, headers=h, method=method)
  try:
    r = urllib.request.urlopen(req, timeout=90)
    return r.status, r.read(), {k.lower(): v for k, v in r.headers.items()}
  except urllib.error.HTTPError as e:
    return e.code, e.read(), {k.lower(): v for k, v in e.headers.items()}

def sign_message(msg: str) -> str:
  p = subprocess.run(
    ['acp', 'wallet', 'sign-message', '--message', msg, '--chain-id', '8453', '--json'],
    capture_output=True, text=True, timeout=90,
  )
  out = (p.stdout or '').strip()
  err = (p.stderr or '').strip()
  try:
    d = json.loads(out)
    sig = d.get('signature') or d.get('sig') or (d.get('data') or {}).get('signature')
    if sig:
      return sig if str(sig).startswith('0x') else '0x' + sig
  except Exception:
    pass
  m = re.search(r'0x[a-fA-F0-9]{130}', out + '\n' + err)
  if m:
    return m.group(0)
  raise RuntimeError(f'sign failed rc={p.returncode}: {(out+err)[:400]}')

def siwx_register(endpoint_path: str, body: dict):
  url = BASE + endpoint_path
  code, raw, hdrs = http('POST', url, body)
  pr = hdrs.get('payment-required') or hdrs.get('x-payment-required')
  if code in (200, 201) and not pr:
    try:
      return code, json.loads(raw.decode())
    except Exception:
      return code, {'raw': raw[:300].decode('utf-8', 'replace')}

  challenge = None
  if pr:
    pad = '=' * (-len(pr) % 4)
    try:
      challenge = json.loads(base64.b64decode(pr + pad))
    except Exception:
      challenge = None
  if challenge is None:
    try:
      challenge = json.loads(raw.decode())
    except Exception:
      return code, {'error': 'no_challenge', 'body': raw[:250].decode('utf-8', 'replace')}

  ext = challenge.get('extensions') or {}
  siwx = ext.get('sign-in-with-x') or ext.get('siwx') or {}
  info = siwx.get('info') if isinstance(siwx, dict) and 'info' in siwx else siwx
  if not isinstance(info, dict):
    info = {}
  nonce = info.get('nonce')
  issued = info.get('issuedAt') or info.get('issued_at')
  exp = info.get('expirationTime') or info.get('expiration_time')
  domain = info.get('domain') or 'www.x402scan.com'
  statement = info.get('statement') or 'Sign in to verify your wallet identity'
  uri = info.get('uri') or url
  if not nonce:
    return code, {'error': 'no_nonce', 'challenge': str(challenge)[:400]}

  msg = (
    f"{domain} wants you to sign in with your Ethereum account:\n"
    f"{AGENT_CS}\n\n{statement}\n\n"
    f"URI: {uri}\nVersion: 1\nChain ID: 8453\nNonce: {nonce}\nIssued At: {issued}"
  )
  if exp:
    msg += f"\nExpiration Time: {exp}"

  sig = sign_message(msg)
  rec = Account.recover_message(encode_defunct(text=msg), signature=sig)
  if rec.lower() != AGENT.lower():
    return 0, {'error': 'bad_recover', 'got': rec, 'want': AGENT_CS}

  payload = {
    'domain': domain,
    'address': AGENT_CS,
    'statement': statement,
    'uri': uri,
    'version': '1',
    'chainId': 'eip155:8453',
    'type': 'eip191',
    'nonce': nonce,
    'issuedAt': issued,
    'signature': sig,
  }
  if exp:
    payload['expirationTime'] = exp
  b64 = base64.b64encode(json.dumps(payload, separators=(',', ':')).encode()).decode()
  code2, raw2, _ = http('POST', url, body, headers={'SIGN-IN-WITH-X': b64})
  try:
    return code2, json.loads(raw2.decode())
  except Exception:
    return code2, {'raw': raw2[:400].decode('utf-8', 'replace')}

def main():
  results = []
  print('=== ORIGIN REGISTER ===', flush=True)
  for origin in ORIGINS:
    try:
      code, resp = siwx_register('/api/x402/registry/register-origin', {'origin': origin})
      print(f'{code} {origin} {json.dumps(resp)[:240]}', flush=True)
      results.append({'type': 'origin', 'target': origin, 'code': code, 'resp': resp})
    except Exception as e:
      print(f'ERR {origin} {e}', flush=True)
      results.append({'type': 'origin', 'target': origin, 'error': str(e)})
    time.sleep(0.6)

  print('=== SNACK REGISTER ===', flush=True)
  for u in SNACKS:
    try:
      code, resp = siwx_register('/api/x402/registry/register', {'url': u})
      print(f'{code} {u.split(".com")[-1]} {json.dumps(resp)[:200]}', flush=True)
      results.append({'type': 'url', 'target': u, 'code': code, 'resp': resp})
    except Exception as e:
      print(f'ERR {u} {e}', flush=True)
      results.append({'type': 'url', 'target': u, 'error': str(e)})
    time.sleep(0.5)

  out = '/tmp/x402scan_register_results.json'
  open(out, 'w').write(json.dumps(results, indent=2, default=str))
  print('saved', out, flush=True)
  return 0

if __name__ == '__main__':
  sys.exit(main())
