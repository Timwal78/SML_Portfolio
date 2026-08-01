import { describe, it, expect, afterEach } from 'vitest';
import { usdcAddress } from '../../src/server/payments/facilitators.js';

/**
 * Regression test for the mainnet-hardening fix (operator directive,
 * 2026-08-01: "everything is on mainnet not testnet ever"). Before this
 * fix, a stray TESTNET=true env var could silently route real payment
 * verification/settlement to Base Sepolia while the REST discovery
 * challenge (server/index.ts's buildAccepts()) stayed hardcoded to
 * mainnet regardless — a real agent paying real mainnet USDC would have
 * had their payment checked against the wrong chain and treated as never
 * having happened. TESTNET now has zero effect anywhere in this codebase.
 */

const USDC_BASE_MAINNET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

afterEach(() => {
  delete process.env['TESTNET'];
});

describe('mainnet-only hardening', () => {
  it('usdcAddress() is always Base mainnet USDC regardless of TESTNET', () => {
    expect(usdcAddress()).toBe(USDC_BASE_MAINNET);
    process.env['TESTNET'] = 'true';
    expect(usdcAddress()).toBe(USDC_BASE_MAINNET);
  });

  it('no Base Sepolia USDC contract address exists anywhere in the payment source', () => {
    // Static guard: the Sepolia USDC address string must not appear in any
    // payment-critical source file — proves the testnet branch was actually
    // removed, not just made unreachable by a runtime flag.
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
    const files = [
      'src/server/payments/facilitators.ts',
      'src/server/payments/verify-inbound.ts',
      'src/lib/chains/base.ts',
    ];
    for (const rel of files) {
      const content = fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf-8');
      expect(content, `${rel} still references the Sepolia USDC address`).not.toContain(SEPOLIA_USDC);
    }
  });
});
