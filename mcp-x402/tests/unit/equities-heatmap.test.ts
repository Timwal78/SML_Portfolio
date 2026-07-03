import { describe, it, expect } from 'vitest';
import { computeRSI } from '../../src/lib/quant/indicators.js';
import { blackScholesDelta } from '../../src/lib/quant/greeks.js';
import { buildHeatmap } from '../../src/lib/quant/heatmap.js';

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
