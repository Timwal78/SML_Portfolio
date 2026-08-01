import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Regression test for a stale default found 2026-08-01 while investigating
 * "54 real ACP offerings, 0 real jobs": acp-self-test-buyer.ts (the
 * documented bootstrap script for clearing Virtuals' 10-sandbox-transaction
 * ACP graduation gate) defaulted SELLER_WALLET_ADDRESS to the OLD, retired
 * "Leviathan" wallet (0x0f035c36c4ce65a6f1bf4370f779bac722d59004) rather
 * than the real, currently-live scriptmasterlabs wallet
 * (0x72330994f379a71542e7bd5a4cf99a9d9743f4aa) — confirmed live via
 * seller.ts's own hard assertion and a real production deploy log. Running
 * the script unmodified would have hired the wrong, dead agent and done
 * nothing toward graduating the real one.
 */
describe('acp-self-test-buyer.ts seller wallet default', () => {
  const content = fs.readFileSync(
    path.resolve(__dirname, '../../scripts/acp-self-test-buyer.ts'),
    'utf-8',
  );

  it('no longer defaults to the retired Leviathan wallet', () => {
    expect(content).not.toContain('0x0f035c36c4ce65a6f1bf4370f779bac722d59004');
  });

  it('defaults to the real, currently-live scriptmasterlabs wallet', () => {
    expect(content).toContain("process.env['SELLER_WALLET_ADDRESS'] ?? '0x72330994f379a71542e7bd5a4cf99a9d9743f4aa'");
  });
});
