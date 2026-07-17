import { describe, it, expect } from 'vitest';
import { computeRSI } from '../../src/lib/quant/indicators.js';
import { blackScholesDelta } from '../../src/lib/quant/greeks.js';
import { buildHeatmap } from '../../src/lib/quant/heatmap.js';
import { pickExtremes } from '../../src/lib/notify/discord.js';
import { nearestToMoney } from '../../src/lib/sml-api/equities-heatmap.js';

describe('computeRSI', () => {
  it('approaches 100 for a steadily rising series', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(computeRSI(closes)).toBe(100);
  });

  it('approaches 0 for a steadily falling series', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 200 - i);
    expect(computeRSI(closes)).toBe(0);
  });

  it('returns null when there is not enough history', () => {
    expect(computeRSI([1, 2, 3])).toBeNull();
  });
});

describe('blackScholesDelta', () => {
  it('is near 1 for a deep in-the-money call', () => {
    const delta = blackScholesDelta({ spot: 200, strike: 100, timeToExpiryYears: 0.25, volatility: 0.3, optionType: 'call' });
    expect(delta).toBeGreaterThan(0.99);
  });

  it('is near 0 for a deep out-of-the-money call', () => {
    const delta = blackScholesDelta({ spot: 100, strike: 200, timeToExpiryYears: 0.25, volatility: 0.3, optionType: 'call' });
    expect(delta).toBeLessThan(0.01);
  });

  it('satisfies put-call delta parity (call - put = 1) at the same strike', () => {
    const call = blackScholesDelta({ spot: 100, strike: 100, timeToExpiryYears: 0.25, volatility: 0.3, optionType: 'call' });
    const put = blackScholesDelta({ spot: 100, strike: 100, timeToExpiryYears: 0.25, volatility: 0.3, optionType: 'put' });
    expect(call - put).toBeCloseTo(1, 6);
  });
});

describe('buildHeatmap', () => {
  it('splits items into 4 groups with correct avg/min/max', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ symbol: `T${i}`, value: i * 8 }));
    const heatmap = buildHeatmap(items, { overboughtThreshold: 70, oversoldThreshold: 30, scale: 'test' });
    expect(heatmap.groups).toHaveLength(4);
    expect(heatmap.groups[0]?.items).toHaveLength(3);
    expect(heatmap.groups[0]?.avg).toBe(8);
    expect(heatmap.groups[3]?.max).toBe(88);
  });

  it('respects a custom groupsOf', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ symbol: `T${i}`, value: i }));
    const heatmap = buildHeatmap(items, { groupsOf: 1 });
    expect(heatmap.groups).toHaveLength(1);
    expect(heatmap.groups[0]?.items).toHaveLength(5);
  });
});

describe('pickExtremes', () => {
  it('finds the single highest- and lowest-value items across all groups', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ symbol: `T${i}`, value: i * 8 }));
    const heatmap = buildHeatmap(items, { overboughtThreshold: 70, oversoldThreshold: 30, scale: 'test' });
    const { top, bottom } = pickExtremes(heatmap);
    expect(top?.symbol).toBe('T11');
    expect(top?.value).toBe(88);
    expect(bottom?.symbol).toBe('T0');
    expect(bottom?.value).toBe(0);
  });

  it('returns nulls for an empty heatmap', () => {
    const heatmap = buildHeatmap([]);
    const { top, bottom } = pickExtremes(heatmap);
    expect(top).toBeNull();
    expect(bottom).toBeNull();
  });
});

describe('nearestToMoney', () => {
  it('picks strikes closest to the underlying price, not the lowest strikes', () => {
    // Regression test: a naive slice(0, N) on a strike-ascending chain always
    // grabbed the deepest-ITM contracts (real bug — every options preview
    // showed |delta|≈100 for every contract regardless of ticker).
    const contracts = [10, 12, 14, 22, 23, 24, 40, 60].map((strike) => ({ strike }));
    const picked = nearestToMoney(contracts, 22.82, 3);
    expect(picked.map((c) => c.strike)).toEqual([23, 22, 24]);
  });

  it('returns all contracts when count exceeds the available list', () => {
    const contracts = [{ strike: 10 }, { strike: 20 }];
    expect(nearestToMoney(contracts, 15, 5)).toHaveLength(2);
  });
});
