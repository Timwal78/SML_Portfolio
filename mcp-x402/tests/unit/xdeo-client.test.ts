import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { XdeoClient } from '../../src/lib/sml-api/xdeo.js';

/**
 * xdeo_earnings_estimate used to call a dead host (api.scriptmasterlabs.com)
 * with no real backend anywhere. Fixed 2026-08-01: XdeoClient now pulls
 * real historical EPS estimate/actual/surprise data from Alpha Vantage's
 * free EARNINGS endpoint. Honestly scoped: revenue and guidance have no
 * free real source and always abstain rather than fabricate; a genuinely
 * future/unreported quarter also abstains rather than guessing.
 */

const ALPHA_VANTAGE_SAMPLE = {
  quarterlyEarnings: [
    { fiscalDateEnding: '2025-03-31', reportedDate: '2025-04-20', reportedEPS: '1.50', estimatedEPS: '1.45', surprise: '0.05', surprisePercentage: '3.45' },
    { fiscalDateEnding: '2024-12-31', reportedDate: '2025-01-20', reportedEPS: '1.30', estimatedEPS: '1.28', surprise: '0.02', surprisePercentage: '1.56' },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env['ALPHA_VANTAGE_API_KEY'];
});

beforeEach(() => {
  process.env['ALPHA_VANTAGE_API_KEY'] = 'test-key';
});

describe('XdeoClient.getEstimate', () => {
  it('honestly reports unavailable when no API key is configured, without ever fetching', async () => {
    delete process.env['ALPHA_VANTAGE_API_KEY'];
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = (await XdeoClient.getInstance().getEstimate({ ticker: 'NVDA', fiscalQuarter: 'Q12025', estimateType: 'eps' })) as { status: string };
    expect(result.status).toBe('unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the real reported/estimated EPS for a matching real fiscal quarter', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ALPHA_VANTAGE_SAMPLE }));
    const result = (await XdeoClient.getInstance().getEstimate({ ticker: 'NVDA', fiscalQuarter: 'Q12025', estimateType: 'eps' })) as {
      status: string;
      fiscal_date_ending: string;
      eps: { estimated_eps: string; reported_eps: string };
    };
    expect(result.status).toBe('success');
    expect(result.fiscal_date_ending).toBe('2025-03-31');
    expect(result.eps.estimated_eps).toBe('1.45');
    expect(result.eps.reported_eps).toBe('1.50');
  });

  it('honestly reports no_data for a fiscal quarter Alpha Vantage has no entry for', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ALPHA_VANTAGE_SAMPLE }));
    const result = (await XdeoClient.getInstance().getEstimate({ ticker: 'NVDA', fiscalQuarter: 'Q42030', estimateType: 'eps' })) as { status: string };
    expect(result.status).toBe('no_data');
  });

  it('always abstains on revenue — never fabricates a figure Alpha Vantage does not provide', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ALPHA_VANTAGE_SAMPLE }));
    const result = (await XdeoClient.getInstance().getEstimate({ ticker: 'NVDA', fiscalQuarter: 'Q12025', estimateType: 'revenue' })) as {
      revenue: { status: string };
    };
    expect(result.revenue.status).toBe('unavailable');
  });

  it('always abstains on guidance — no free source exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ALPHA_VANTAGE_SAMPLE }));
    const result = (await XdeoClient.getInstance().getEstimate({ ticker: 'NVDA', fiscalQuarter: 'Q12025', estimateType: 'guidance' })) as {
      guidance: { status: string };
    };
    expect(result.guidance.status).toBe('unavailable');
  });

  it('surfaces a real Alpha Vantage rate-limit message honestly instead of an empty result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ Note: 'Thank you for using Alpha Vantage! Our standard API rate limit is...' }) }));
    const result = (await XdeoClient.getInstance().getEstimate({ ticker: 'NVDA', fiscalQuarter: 'Q12025', estimateType: 'eps' })) as { status: string; message: string };
    expect(result.status).toBe('rate_limited_or_unavailable');
    expect(result.message).toContain('rate limit');
  });

  it('throws on a real HTTP failure rather than returning a fabricated empty success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(
      XdeoClient.getInstance().getEstimate({ ticker: 'NVDA', fiscalQuarter: 'Q12025', estimateType: 'eps' }),
    ).rejects.toThrow(/500/);
  });
});
