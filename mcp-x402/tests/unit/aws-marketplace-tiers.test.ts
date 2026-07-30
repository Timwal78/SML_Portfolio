import { describe, it, expect, afterEach } from 'vitest';
import {
  TIER_MONTHLY_CALL_CAP,
  resolveTierFromDimension,
  currentPeriodStart,
  computeUsageDecision,
} from '../../src/server/aws/tiers.js';

describe('resolveTierFromDimension', () => {
  afterEach(() => {
    delete process.env['AWS_MARKETPLACE_TIER_DIMENSIONS_JSON'];
  });

  it('returns null when the env var is unset', () => {
    expect(resolveTierFromDimension('contractor-calls')).toBeNull();
  });

  it('returns null for an undefined/empty dimension regardless of config', () => {
    process.env['AWS_MARKETPLACE_TIER_DIMENSIONS_JSON'] = '{"contractor-calls":"contractor"}';
    expect(resolveTierFromDimension(undefined)).toBeNull();
    expect(resolveTierFromDimension(null)).toBeNull();
  });

  it('maps a configured dimension to its internal tier', () => {
    process.env['AWS_MARKETPLACE_TIER_DIMENSIONS_JSON'] = JSON.stringify({
      'contractor-calls': 'contractor',
      'professional-calls': 'professional',
    });
    expect(resolveTierFromDimension('contractor-calls')).toBe('contractor');
    expect(resolveTierFromDimension('professional-calls')).toBe('professional');
  });

  it('returns null for an unmapped dimension (never fabricates a tier)', () => {
    process.env['AWS_MARKETPLACE_TIER_DIMENSIONS_JSON'] = '{"contractor-calls":"contractor"}';
    expect(resolveTierFromDimension('some-dimension-nobody-mapped')).toBeNull();
  });

  it('returns null and does not throw on malformed JSON', () => {
    process.env['AWS_MARKETPLACE_TIER_DIMENSIONS_JSON'] = 'not valid json{{{';
    expect(resolveTierFromDimension('contractor-calls')).toBeNull();
  });
});

describe('currentPeriodStart', () => {
  it('formats as YYYY-MM-01 in UTC', () => {
    expect(currentPeriodStart(new Date('2026-07-29T23:59:59Z'))).toBe('2026-07-01');
    expect(currentPeriodStart(new Date('2026-01-05T00:00:00Z'))).toBe('2026-01-01');
    expect(currentPeriodStart(new Date('2026-12-31T12:00:00Z'))).toBe('2026-12-01');
  });
});

describe('computeUsageDecision', () => {
  const CAP = 5000;

  it('allows and increments a fresh customer with no stored period', () => {
    const d = computeUsageDecision(CAP, 0, null, '2026-07-01');
    expect(d).toEqual({ withinCap: true, newCount: 1, periodStart: '2026-07-01' });
  });

  it('allows and increments while under cap in the same period', () => {
    const d = computeUsageDecision(CAP, 4998, '2026-07-01', '2026-07-01');
    expect(d).toEqual({ withinCap: true, newCount: 4999, periodStart: '2026-07-01' });
  });

  it('denies (overage) once the stored count has reached the cap', () => {
    const d = computeUsageDecision(CAP, 5000, '2026-07-01', '2026-07-01');
    expect(d.withinCap).toBe(false);
    expect(d.newCount).toBe(5000); // never incremented past the cap
  });

  it('denies (overage) once the stored count is past the cap', () => {
    const d = computeUsageDecision(CAP, 5001, '2026-07-01', '2026-07-01');
    expect(d.withinCap).toBe(false);
  });

  it('resets to 0-then-1 on a period rollover, even if the prior period was over cap', () => {
    const d = computeUsageDecision(CAP, 9999, '2026-06-01', '2026-07-01');
    expect(d).toEqual({ withinCap: true, newCount: 1, periodStart: '2026-07-01' });
  });
});

describe('TIER_MONTHLY_CALL_CAP', () => {
  it('covers all four published tiers with the documented assumption', () => {
    expect(TIER_MONTHLY_CALL_CAP['contractor']).toBe(5000);
    expect(TIER_MONTHLY_CALL_CAP['professional']).toBe(25000);
    expect(TIER_MONTHLY_CALL_CAP['authority_enterprise']).toBe(100000);
    expect(TIER_MONTHLY_CALL_CAP['government']).toBe(Infinity);
  });
});
