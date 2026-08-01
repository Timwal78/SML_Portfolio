import { describe, it, expect, vi, afterEach } from 'vitest';
import { SqueezeOSAPI } from '../../src/lib/sml-api/squeezeos.js';

/**
 * Regression test for the squeezeos_oracle timeout bug (found 2026-08-01,
 * diagnosed in UPSTREAM_FTD_ISSUES.md). SqueezeOSAPI.oracle(symbol) used to
 * build `/api/oracle/<symbol>` as a URL path segment — that SqueezeOS route
 * runs a fresh, uncached OracleEngine analysis per request and can hang
 * 30s+. `/api/oracle` (no segment) serves an instantly-cached batch; the
 * fix always calls that and filters client-side by symbol.
 */
function mockFetchOnce(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      json: async () => body,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SqueezeOSAPI.oracle', () => {
  it('always calls the batch route, never a path-segment symbol route', async () => {
    mockFetchOnce({ status: 'success', symbols: { GME: { directive: 'BUY' } }, universe_size: 1 });
    await SqueezeOSAPI.oracle('gme');
    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).toMatch(/\/api\/oracle$/);
    expect(calledUrl).not.toMatch(/\/api\/oracle\/gme/i);
  });

  it('returns the full batch unfiltered when no symbol is given', async () => {
    const batch = { status: 'success', symbols: { GME: {}, AMC: {} }, universe_size: 2 };
    mockFetchOnce(batch);
    const result = await SqueezeOSAPI.oracle();
    expect(result).toEqual(batch);
  });

  it('filters the batch to the requested symbol, case-insensitively', async () => {
    mockFetchOnce({
      status: 'success',
      symbols: { GME: { directive: 'BUY', confidence: 90 } },
      universe_size: 1,
    });
    const result = (await SqueezeOSAPI.oracle('gme')) as { status: string; oracle: unknown };
    expect(result.status).toBe('success');
    expect(result.oracle).toEqual({ directive: 'BUY', confidence: 90 });
  });

  it('reports not_found honestly when the symbol is absent from the batch, never fabricating data', async () => {
    mockFetchOnce({ status: 'success', symbols: { GME: {} }, universe_size: 1 });
    const result = (await SqueezeOSAPI.oracle('ZZZZ')) as { status: string; symbol: string };
    expect(result.status).toBe('not_found');
    expect(result.symbol).toBe('ZZZZ');
  });
});
