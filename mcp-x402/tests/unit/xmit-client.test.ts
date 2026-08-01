import { describe, it, expect, vi, afterEach } from 'vitest';
import dns from 'node:dns/promises';
import { XmitClient } from '../../src/lib/sml-api/xmit.js';

/**
 * xmit_edgar_decode used to call a dead host (api.scriptmasterlabs.com)
 * with no real backend anywhere. Fixed 2026-08-01: XmitClient now does a
 * real SEC EDGAR fetch (SSRF-guarded) + best-effort structural extraction
 * — locating real tables near recognizable section headers rather than
 * fabricating data for filing layouts it can't confidently parse.
 */

const DEF_14A_SAMPLE = `<!doctype html>
<html><body>
<p>Item 11. Executive Compensation</p>
<p><b>Summary Compensation Table</b></p>
<table>
  <tr><th>Name and Principal Position</th><th>Year</th><th>Salary</th></tr>
  <tr><td>Jane Doe, CEO</td><td>2025</td><td>$1,000,000</td></tr>
  <tr><td>John Smith, CFO</td><td>2025</td><td>$600,000</td></tr>
</table>
<p>Unrelated table below:</p>
<table><tr><td>Not compensation</td></tr></table>
</body></html>`;

const THIRTEEN_D_SAMPLE = `<!doctype html>
<html><body>
<p><b>Item 5. Interest in Securities of the Issuer</b></p>
<table>
  <tr><th>Reporting Person</th><th>Shares</th><th>Percent of Class</th></tr>
  <tr><td>Acme Capital LP</td><td>1,200,000</td><td>9.8%</td></tr>
</table>
</body></html>`;

const INFOTABLE_XML_SAMPLE = `<?xml version="1.0"?>
<informationTable>
  <infoTable>
    <nameOfIssuer>Example Corp</nameOfIssuer>
    <cusip>123456789</cusip>
    <value>50000</value>
    <shrsOrPrnAmt><sshPrnamt>10000</sshPrnamt></shrsOrPrnAmt>
  </infoTable>
  <infoTable>
    <nameOfIssuer>Other Corp</nameOfIssuer>
    <cusip>987654321</cusip>
    <value>25000</value>
    <shrsOrPrnAmt><sshPrnamt>5000</sshPrnamt></shrsOrPrnAmt>
  </infoTable>
</informationTable>`;

function mockFetch(body: string, contentType = 'text/html') {
  vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '104.18.10.10', family: 4 }] as never);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => body,
    }),
  );
  void contentType;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('XmitClient.decode', () => {
  it('extracts a real executive-pay table near "Summary Compensation Table"', async () => {
    mockFetch(DEF_14A_SAMPLE);
    const result = (await XmitClient.getInstance().decode({
      filingUrl: 'https://www.sec.gov/Archives/edgar/data/1/def14a.htm',
      parseTarget: 'executive_pay',
      format: 'json',
    })) as { executive_pay: { found: boolean; tables: Array<{ rows: string[][] }> } };

    expect(result.executive_pay.found).toBe(true);
    expect(result.executive_pay.tables[0]!.rows).toContainEqual(['Jane Doe, CEO', '2025', '$1,000,000']);
    // The unrelated table must not be picked up as compensation data
    expect(result.executive_pay.tables.some((t) => t.rows.some((r) => r.includes('Not compensation')))).toBe(false);
  });

  it('extracts real ownership-change data near "Item 5"', async () => {
    mockFetch(THIRTEEN_D_SAMPLE);
    const result = (await XmitClient.getInstance().decode({
      filingUrl: 'https://www.sec.gov/Archives/edgar/data/1/13d.htm',
      parseTarget: 'ownership_changes',
      format: 'json',
    })) as { ownership_changes: { found: boolean; tables: Array<{ rows: string[][] }> } };

    expect(result.ownership_changes.found).toBe(true);
    expect(result.ownership_changes.tables[0]!.rows).toContainEqual(['Acme Capital LP', '1,200,000', '9.8%']);
  });

  it('parses a real 13F XML information table for holdings', async () => {
    mockFetch(INFOTABLE_XML_SAMPLE);
    const result = (await XmitClient.getInstance().decode({
      filingUrl: 'https://www.sec.gov/Archives/edgar/data/1/infotable.xml',
      parseTarget: 'holdings',
      format: 'json',
    })) as { holdings: { found: boolean; holdings: Array<{ name_of_issuer: string; value: string }> } };

    expect(result.holdings.found).toBe(true);
    expect(result.holdings.holdings).toHaveLength(2);
    expect(result.holdings.holdings[0]).toMatchObject({ name_of_issuer: 'Example Corp', value: '50000' });
  });

  it('honestly reports found:false for holdings when given a non-XML document, never fabricating', async () => {
    mockFetch(DEF_14A_SAMPLE);
    const result = (await XmitClient.getInstance().decode({
      filingUrl: 'https://www.sec.gov/Archives/edgar/data/1/def14a.htm',
      parseTarget: 'holdings',
      format: 'json',
    })) as { holdings: { found: boolean; holdings: unknown[]; note: string } };

    expect(result.holdings.found).toBe(false);
    expect(result.holdings.holdings).toEqual([]);
    expect(result.holdings.note).toBeTruthy();
  });

  it('always includes an honest disclosure that this is best-effort, not a certified parse', async () => {
    mockFetch(DEF_14A_SAMPLE);
    const result = (await XmitClient.getInstance().decode({
      filingUrl: 'https://www.sec.gov/Archives/edgar/data/1/def14a.htm',
      parseTarget: 'all',
      format: 'json',
    })) as { disclosure: string };
    expect(result.disclosure).toMatch(/best-effort/i);
  });

  it('throws on a non-2xx EDGAR response rather than returning empty structured data', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '104.18.10.10', family: 4 }] as never);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => '' }));
    await expect(
      XmitClient.getInstance().decode({ filingUrl: 'https://www.sec.gov/Archives/edgar/data/1/missing.htm', parseTarget: 'all', format: 'json' }),
    ).rejects.toThrow(/404/);
  });

  it('is SSRF-guarded — rejects a filing URL that resolves to a private address', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '10.0.0.5', family: 4 }] as never);
    await expect(
      XmitClient.getInstance().decode({ filingUrl: 'https://www.sec.gov/fake', parseTarget: 'all', format: 'json' }),
    ).rejects.toThrow(/private\/reserved/);
  });
});
