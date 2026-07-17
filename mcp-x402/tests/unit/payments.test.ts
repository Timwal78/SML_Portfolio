import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PriceRegistry } from '../../src/server/registry/pricing.js';

describe('PriceRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns seeded baseline prices', async () => {
    const registry = PriceRegistry.getInstance();
    registry.seedDefaults();
    const price = await registry.getPrice('leviathan_signal');
    expect(price).toBe('0.05');
  });

  it('returns null for unknown tool when API unavailable', async () => {
    const registry = PriceRegistry.getInstance();
    const price = await registry.getPrice('nonexistent_tool');
    expect(price).toBeNull();
  });

  it('returns crawl price as 0.005', async () => {
    const registry = PriceRegistry.getInstance();
    registry.seedDefaults();
    const price = await registry.getPrice('crawl_paid_fetch');
    expect(price).toBe('0.005');
  });

  it('returns xmit price as 0.02', async () => {
    const registry = PriceRegistry.getInstance();
    registry.seedDefaults();
    const price = await registry.getPrice('xmit_edgar_decode');
    expect(price).toBe('0.02');
  });

  it('returns xdeo price as 0.02', async () => {
    const registry = PriceRegistry.getInstance();
    registry.seedDefaults();
    const price = await registry.getPrice('xdeo_earnings_estimate');
    expect(price).toBe('0.02');
  });

  it('returns ftd price as 0.05', async () => {
    const registry = PriceRegistry.getInstance();
    registry.seedDefaults();
    const price = await registry.getPrice('ftd_threshold_scan');
    expect(price).toBe('0.05');
  });
});
