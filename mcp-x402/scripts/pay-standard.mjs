/**
 * One-shot x402 standard-rail payment.
 *
 * Signs an EIP-3009 TransferWithAuthorization, encodes it as X-PAYMENT,
 * and calls a paid REST endpoint on mcp-x402.onrender.com. When CDP API keys
 * are configured on Render, this payment routes through CDP's facilitator
 * first — which is what triggers the route being cataloged in the x402 Bazaar.
 *
 * Prerequisites:
 *   - Run from the mcp-x402/ directory (so viem is importable from node_modules)
 *   - A Base wallet with enough USDC to cover the route price
 *   - PAYER_PRIVATE_KEY set in the environment
 *
 * Usage:
 *   PAYER_PRIVATE_KEY=0x<your-key> node scripts/pay-standard.mjs
 *
 * Optional overrides (all have sane defaults):
 *   ENDPOINT=/x402/firms        (which route to call)
 *   QUERY=naics=541512          (query string, no leading ?)
 *   PRICE=0.03                  (USDC — must match what the server charges)
 *   API_BASE=https://mcp-x402.onrender.com
 *   PAY_TO=0x4e14B249D9A4c9c9352D780eCEB508A8eB7a7700
 *   BASE_RPC_URL=https://mainnet.base.org
 */

import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { randomBytes } from 'crypto';

// ─── Config ──────────────────────────────────────────────────────────────────

const USDC_BASE        = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PAY_TO           = process.env.PAY_TO           ?? '0x4e14B249D9A4c9c9352D780eCEB508A8eB7a7700';
const API_BASE         = process.env.API_BASE         ?? 'https://mcp-x402.onrender.com';
const ENDPOINT         = process.env.ENDPOINT         ?? '/x402/firms';
const QUERY            = process.env.QUERY            ?? 'naics=541512';
const PRICE            = process.env.PRICE            ?? '0.03';
const BASE_RPC_URL     = process.env.BASE_RPC_URL     ?? 'https://mainnet.base.org';
const PRIVATE_KEY      = process.env.PAYER_PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error('ERROR: set PAYER_PRIVATE_KEY=0x<your-wallet-private-key>');
  console.error('  The wallet must hold USDC on Base mainnet.');
  process.exit(1);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function usdcToUnits(amount) {
  const [whole = '0', frac = ''] = amount.split('.');
  const fracPadded = (frac + '000000').slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(fracPadded || '0');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const account = privateKeyToAccount(PRIVATE_KEY);
  const client  = createWalletClient({ account, chain: base, transport: http(BASE_RPC_URL) });

  const value       = usdcToUnits(PRICE);
  const now         = BigInt(Math.floor(Date.now() / 1000));
  const validBefore = now + 300n;                                   // 5-minute window
  const nonce       = `0x${randomBytes(32).toString('hex')}`;       // random bytes32

  console.log('─── EIP-3009 TransferWithAuthorization ───────────────────────');
  console.log('from        :', account.address);
  console.log('to          :', PAY_TO);
  console.log('value       :', `${value.toString()} units (${PRICE} USDC)`);
  console.log('validAfter  : 0 (immediate)');
  console.log('validBefore :', validBefore.toString(), `(${new Date(Number(validBefore) * 1000).toISOString()})`);
  console.log('nonce       :', nonce);
  console.log('');

  const sig = await client.signTypedData({
    domain: {
      name:              'USD Coin',
      version:           '2',
      chainId:           8453,
      verifyingContract: USDC_BASE,
    },
    types: {
      TransferWithAuthorization: [
        { name: 'from',        type: 'address' },
        { name: 'to',          type: 'address' },
        { name: 'value',       type: 'uint256' },
        { name: 'validAfter',  type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce',       type: 'bytes32'  },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: {
      from:        account.address,
      to:          PAY_TO,
      value,
      validAfter:  0n,
      validBefore,
      nonce,
    },
  });

  console.log('signature   :', sig.slice(0, 20) + '...');
  console.log('');

  // Build the x402 standard-rail payload (x402Version 1 / scheme "exact").
  // The server's decodePaymentHeader() base64-decodes this and passes it to
  // facilitatorChain().process(), which tries CDP first (if keys are set),
  // then x402.org as fallback.
  const payload = {
    x402Version: 1,
    scheme:  'exact',
    network: 'base',
    payload: {
      signature: sig,
      authorization: {
        from:        account.address,
        to:          PAY_TO,
        value:       value.toString(),
        validAfter:  '0',
        validBefore: validBefore.toString(),
        nonce,
      },
    },
  };

  const xPayment = Buffer.from(JSON.stringify(payload)).toString('base64');
  const url      = `${API_BASE}${ENDPOINT}?${QUERY}`;

  console.log('─── HTTP request ─────────────────────────────────────────────');
  console.log('URL         :', url);
  console.log('X-PAYMENT   :', `[${xPayment.length} chars base64]`);
  console.log('');

  const res  = await fetch(url, { headers: { 'X-PAYMENT': xPayment } });
  const body = await res.text();

  console.log('─── Response ─────────────────────────────────────────────────');
  console.log('HTTP status :', res.status);
  try {
    console.log(JSON.stringify(JSON.parse(body), null, 2));
  } catch {
    console.log(body.slice(0, 3000));
  }
  console.log('');

  if (res.status === 200) {
    console.log('✅  Standard-rail payment settled.');
    console.log('    If CDP_API_KEY_ID/SECRET are set on Render, this route');
    console.log('    is now cataloged in the x402 Bazaar.');
  } else if (res.status === 402) {
    console.log('⚠️   402 returned — payment was not accepted.');
    console.log('    Likely cause: CDP/x402.org facilitator rejected the EIP-3009 payload.');
    console.log('    Check Render logs for [warn] facilitator_verify_failed lines.');
  } else {
    console.log('❌  Unexpected status — check Render logs.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message ?? err);
  process.exit(1);
});
