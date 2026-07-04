import { describe, it, expect } from 'vitest';
import { executeX402Payment, usdcToUnits } from '../../src/server/payments/x402.js';
import { markRedeemed } from '../../src/server/payments/verify-inbound.js';
import { PriceRegistry } from '../../src/server/registry/pricing.js';

describe('usdcToUnits', () => {
  it('converts decimal USDC prices to 6-decimal base units', () => {
    expect(usdcToUnits('0.10')).toBe(100_000n);
    expect(usdcToUnits('0.005')).toBe(5_000n);
    expect(usdcToUnits('1')).toBe(1_000_000n);
    expect(usdcToUnits('0.30')).toBe(300_000n);
  });

  it('rejects malformed price strings', () => {
    expect(() => usdcToUnits('abc')).toThrow('invalid_price_format');
    expect(() => usdcToUnits('-0.10')).toThrow('invalid_price_format');
    expect(() => usdcToUnits('')).toThrow('invalid_price_format');
  });
});

describe('executeX402Payment — real-payment gate (no network reached in these cases)', () => {
  it('rejects a stale/unknown tool name before any verification', async () => {
    await expect(
      executeX402Payment({ price: '0.10', currency: 'USDC', toolName: 'definitely_not_a_real_tool' }),
    ).rejects.toThrow(/Price data stale or unavailable/);
  });

  it('rejects a price that does not match the registry (anti-drift/tamper guard)', async () => {
    const registry = PriceRegistry.getInstance();
    registry.seedDefaults();
    await expect(
      executeX402Payment({ price: '99.00', currency: 'USDC', toolName: 'leviathan_signal' }),
    ).rejects.toThrow(/Price mismatch/);
  });

  it('demands a payment_tx_hash or payment_header when neither is supplied', async () => {
    const registry = PriceRegistry.getInstance();
    registry.seedDefaults();
    await expect(
      executeX402Payment({ price: '0.05', currency: 'USDC', toolName: 'leviathan_signal' }),
    ).rejects.toThrow(/Payment required/);
  });

  it('rejects unsupported currencies (only USDC on Base is verifiable today)', async () => {
    const registry = PriceRegistry.getInstance();
    registry.seedDefaults();
    await expect(
      executeX402Payment({ price: '0.05', currency: 'RLUSD', toolName: 'leviathan_signal', paymentTxHash: '0x' + '1'.repeat(64) }),
    ).rejects.toThrow(/unsupported_currency/);
  });

  it('rejects a tx hash that was already redeemed by a previous call', async () => {
    const registry = PriceRegistry.getInstance();
    registry.seedDefaults();
    const txHash = '0x' + '7'.repeat(64);
    markRedeemed(txHash);
    await expect(
      executeX402Payment({ price: '0.05', currency: 'USDC', toolName: 'leviathan_signal', paymentTxHash: txHash }),
    ).rejects.toThrow(/payment_already_redeemed/);
  });
});
