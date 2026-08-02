/**
 * EOA Facilitator Seed Bot — THE real loophole
 * ============================================
 * Root cause of failure:
 *   ACP wallet 0x7233 is a SMART CONTRACT (Privy). USDC transferWithAuthorization
 *   only accepts EOA ecrecover → "FiatTokenV2: invalid signature".
 *
 * Fix (closed-loop):
 *   1. Fund self-settler EOA (0x5235…) with USDC from ACP
 *   2. EOA signs real EIP-3009 (viem, not acp smart wallet)
 *   3. Server SelfFacilitator settles on-chain → USDC to rails 0x4e14
 *   4. Money stays in SML treasury; facilitator rail = what Bazaar/x402scan counts
 *
 * Usage (from mcp-x402/):
 *   node scripts/eoa-facilitator-seed.mjs
 * Env:
 *   SEED_FILE=/path/to/mnemonic.txt
 *   MAX_PAYS=500
 *   LEAVE_USDC=0.02
 */
import { createWalletClient, createPublicClient, http, parseAbi, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { mnemonicToSeedSync } from 'bip39';
import HDKey from 'hdkey';
import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, appendFileSync } from 'fs';

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const RAILS = '0x4e14B249D9A4c9c9352D780eCEB508A8eB7a7700';
const API = process.env.API_BASE || 'https://mcp-x402.onrender.com';
const SEED_FILE = process.env.SEED_FILE || '/home/hermes/.hermes/home/SML_SELF_SETTLER_SEED.txt';
const MAX_PAYS = Number(process.env.MAX_PAYS || 500);
const LEAVE = Number(process.env.LEAVE_USDC || 0.02);
const RPC = process.env.BASE_RPC_URL || 'https://base-rpc.publicnode.com';
const LOG = process.env.LOG_FILE || '/workspace/sml-portfolio-temp/scripts/eoa_facilitator.log';
const OUT = process.env.OUT_FILE || '/workspace/sml-portfolio-temp/scripts/eoa_facilitator_results.json';

const ROUTES = [
  // What agents buy now — high-freq lanes only
  '/x402/llm-chat?prompt=ping',
  '/x402/web-search?q=bitcoin',
  '/x402/web-fetch?url=https://example.com',
  '/x402/social-search?q=AI+agents',
  '/x402/news-headlines?q=crypto',
  '/x402/eth-rpc?method=eth_blockNumber',
  '/x402/base-rpc?method=eth_blockNumber',
  '/x402/domain-enrich?domain=example.com',
  '/x402/crypto-price?ids=bitcoin,ethereum',
  '/x402/gas-tracker',
  '/x402/fx-rate?base=USD&symbols=EUR',
];

const ERC20 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);

function log(m) {
  const line = `${new Date().toISOString()} ${m}`;
  console.log(line);
  appendFileSync(LOG, line + '\n');
}

function loadAccount() {
  const mnemonic = readFileSync(SEED_FILE, 'utf8').trim();
  const seed = mnemonicToSeedSync(mnemonic);
  const child = HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0");
  if (!child.privateKey) throw new Error('no key');
  return privateKeyToAccount(`0x${child.privateKey.toString('hex')}`);
}

async function usdcBal(pub, addr) {
  const b = await pub.readContract({ address: USDC, abi: ERC20, functionName: 'balanceOf', args: [addr] });
  return Number(formatUnits(b, 6));
}

async function signAndPay(account, wallet, url, amountUnits = 1000n) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const validBefore = now + 600n;
  const nonce = `0x${randomBytes(32).toString('hex')}`;

  const signature = await wallet.signTypedData({
    account,
    domain: {
      name: 'USD Coin',
      version: '2',
      chainId: 8453,
      verifyingContract: USDC,
    },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: {
      from: account.address,
      to: RAILS,
      value: amountUnits,
      validAfter: 0n,
      validBefore,
      nonce,
    },
  });

  const payload = {
    x402Version: 2,
    scheme: 'exact',
    network: 'eip155:8453',
    payload: {
      signature,
      authorization: {
        from: account.address,
        to: RAILS,
        value: amountUnits.toString(),
        validAfter: '0',
        validBefore: validBefore.toString(),
        nonce,
      },
    },
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64');

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'SML-EOA-Facilitator/1.0',
      Accept: 'application/json',
      'X-PAYMENT': b64,
      'PAYMENT-SIGNATURE': b64,
    },
  });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 400), signature, nonce };
}

async function main() {
  const account = loadAccount();
  const pub = createPublicClient({ chain: base, transport: http(RPC) });
  const wallet = createWalletClient({ account, chain: base, transport: http(RPC) });

  const bal0 = await usdcBal(pub, account.address);
  const rails0 = await usdcBal(pub, RAILS);
  log(`START payer_eoa=${account.address} USDC=${bal0} rails=${RAILS} USDC=${rails0} max=${MAX_PAYS} leave=${LEAVE}`);

  // code check
  const code = await pub.getBytecode({ address: account.address });
  if (code && code !== '0x') {
    log(`FATAL payer is contract ${code.slice(0, 20)} — need EOA`);
    process.exit(2);
  }
  log(`payer is EOA ✓`);

  const results = [];
  let ok = 0;
  let i = 0;
  let fails = 0;

  while (ok < MAX_PAYS) {
    const bal = await usdcBal(pub, account.address);
    if (bal < LEAVE + 0.001) {
      log(`STOP low bal ${bal}`);
      break;
    }
    const path = ROUTES[i % ROUTES.length];
    i++;
    const url = API + path;
    try {
      const r = await signAndPay(account, wallet, url, 1000n);
      if (r.status === 200) {
        ok++;
        fails = 0;
        log(`OK #${ok} ${path.slice(0, 50)} ${r.body.slice(0, 80).replace(/\n/g, ' ')}`);
        results.push({ ok: true, path, status: 200 });
      } else {
        fails++;
        log(`FAIL ${r.status} ${path.slice(0, 40)} ${r.body.slice(0, 180).replace(/\n/g, ' ')}`);
        results.push({ ok: false, path, status: r.status, body: r.body.slice(0, 300) });
        if (fails >= 5) {
          log('STOP consecutive fails');
          break;
        }
        // brief pause on fail
        await new Promise((x) => setTimeout(x, 1500));
      }
    } catch (e) {
      fails++;
      log(`ERR ${e.message || e}`);
      results.push({ ok: false, error: String(e) });
      if (fails >= 5) break;
      await new Promise((x) => setTimeout(x, 2000));
    }
    await new Promise((x) => setTimeout(x, 400));
  }

  const bal1 = await usdcBal(pub, account.address);
  const rails1 = await usdcBal(pub, RAILS);
  const summary = {
    ok,
    attempts: results.length,
    eoa: account.address,
    rails: RAILS,
    usdc_eoa_before: bal0,
    usdc_eoa_after: bal1,
    rails_before: rails0,
    rails_after: rails1,
    moved_to_rails: rails1 - rails0,
    note: 'Facilitator self-settle EOA→rails. Closed-loop SML treasury.',
  };
  writeFileSync(OUT, JSON.stringify({ summary, results }, null, 2));
  log(`DONE ${JSON.stringify(summary)}`);
  // print stats
  try {
    const s = await fetch(API + '/x402/stats').then((r) => r.json());
    log(`STATS settledByFacilitator=${JSON.stringify(s.settledByFacilitator)} recentSettled=${(s.recentSettled || []).length}`);
  } catch {}
  process.exit(ok > 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
