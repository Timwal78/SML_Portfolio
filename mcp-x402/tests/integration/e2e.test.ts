/**
 * Integration tests — read-only checks (wallet derivation, credit score,
 * price cache), no on-chain transaction is ever sent by this file.
 * Set INTEGRATION_TEST=true and CI_WALLET_SEED to run.
 * These tests are skipped in unit-only CI runs.
 *
 * Previously gated on TESTNET=true and documented as "targets Base Sepolia
 * testnet only" — stale as of the 2026-08-01 mainnet-only hardening
 * (facilitators.ts/verify-inbound.ts/lib/chains/base.ts no longer have a
 * testnet code path at all, so that env var stopped meaning anything here).
 * Renamed to avoid implying a testnet safety net that no longer exists —
 * this file never transacted anyway, but the misleading claim shouldn't
 * stick around now that it's provably false.
 */
import { describe, it, expect } from 'vitest';

const INTEGRATION = process.env['INTEGRATION_TEST'] === 'true' && !!process.env['CI_WALLET_SEED'];

describe.skipIf(!INTEGRATION)('E2E Integration (read-only)', () => {
  it('WalletManager derives consistent address', async () => {
    const { WalletManager } = await import('../../src/server/payments/wallet.js');
    const w = await WalletManager.getInstance().getOrCreateWallet();
    expect(w.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    // Second call returns same address
    const w2 = await WalletManager.getInstance().getOrCreateWallet();
    expect(w.address).toBe(w2.address);
  });

  it('CreditBureau returns a score >= 0', async () => {
    const { WalletManager } = await import('../../src/server/payments/wallet.js');
    const { CreditBureau } = await import('../../src/lib/credit/bureau.js');
    const wallet = await WalletManager.getInstance().getOrCreateWallet();
    const score = await CreditBureau.getInstance().getScore(wallet.address);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(850);
  });

  it('PriceRegistry fetches or falls back within 5s', async () => {
    const { PriceRegistry } = await import('../../src/server/registry/pricing.js');
    const start = Date.now();
    const price = await PriceRegistry.getInstance().getPrice('leviathan_signal');
    const elapsed = Date.now() - start;
    expect(price).not.toBeNull();
    expect(elapsed).toBeLessThan(5000);
  });
});

// Offline sanity checks always run
describe('Offline sanity', () => {
  it('Sandbox URL validation works without network', async () => {
    const { Sandbox } = await import('../../src/server/security/sandbox.js');
    expect(() => Sandbox.validateUrl('https://www.sec.gov/test')).not.toThrow();
    expect(() => Sandbox.validateUrl('javascript:alert()')).toThrow();
  });

  it('AuditLogger does not throw on write', async () => {
    const { AuditLogger } = await import('../../src/server/security/audit.js');
    expect(() => AuditLogger.getInstance().info('test_event', { key: 'val' })).not.toThrow();
  });
});
