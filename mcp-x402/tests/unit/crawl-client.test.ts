import { describe, it, expect, vi, afterEach } from 'vitest';
import dns from 'node:dns/promises';
import { CrawlClient } from '../../src/lib/sml-api/crawl.js';

/**
 * crawl_paid_fetch used to call a dead host (api.scriptmasterlabs.com) with
 * no real backend anywhere. Fixed 2026-08-01: CrawlClient now performs a
 * real, self-contained fetch + HTML extraction (cheerio), SSRF-guarded via
 * ssrfSafeFetch. These tests exercise the real extraction logic against a
 * real (mocked-fetch) HTML payload — no network access needed to verify
 * the parsing itself is correct.
 */

const SAMPLE_HTML = `<!doctype html>
<html>
<head>
  <title>Example Page</title>
  <meta name="description" content="A sample page for testing.">
  <script type="application/ld+json">{"@type":"Article","headline":"Test"}</script>
</head>
<body>
  <script>var x = 1;</script>
  <h1>Main Heading</h1>
  <p>Some visible text content.</p>
  <a href="/relative-link">Relative</a>
  <a href="https://other.example.test/page">Absolute</a>
  <table>
    <tr><th>Name</th><th>Value</th></tr>
    <tr><td>Alpha</td><td>1</td></tr>
    <tr><td>Beta</td><td>2</td></tr>
  </table>
</body>
</html>`;

function mockHtmlFetch() {
  vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      arrayBuffer: async () => new TextEncoder().encode(SAMPLE_HTML).buffer,
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CrawlClient.fetch', () => {
  it('extracts visible text, stripping script/style content', async () => {
    mockHtmlFetch();
    const result = await CrawlClient.getInstance().fetch({ url: 'https://public.example.test/', extract: 'text' });
    expect(result.content).toContain('Main Heading');
    expect(result.content).toContain('Some visible text content.');
    expect(result.content).not.toContain('var x = 1');
  });

  it('extracts links as absolute URLs with visible text', async () => {
    mockHtmlFetch();
    const result = await CrawlClient.getInstance().fetch({ url: 'https://public.example.test/page', extract: 'links' });
    const links = result.content as Array<{ href: string; text: string }>;
    expect(links).toContainEqual({ href: 'https://public.example.test/relative-link', text: 'Relative' });
    expect(links).toContainEqual({ href: 'https://other.example.test/page', text: 'Absolute' });
  });

  it('extracts table rows as arrays of cell text', async () => {
    mockHtmlFetch();
    const result = await CrawlClient.getInstance().fetch({ url: 'https://public.example.test/', extract: 'tables' });
    const tables = result.content as string[][][];
    expect(tables).toEqual([[['Name', 'Value'], ['Alpha', '1'], ['Beta', '2']]]);
  });

  it('extracts structured data: title, meta, headings, JSON-LD', async () => {
    mockHtmlFetch();
    const result = await CrawlClient.getInstance().fetch({ url: 'https://public.example.test/', extract: 'structured' });
    const structured = result.content as { title: string; meta: Record<string, string>; headings: string[]; json_ld: unknown[] };
    expect(structured.title).toBe('Example Page');
    expect(structured.meta['description']).toBe('A sample page for testing.');
    expect(structured.headings).toEqual(['Main Heading']);
    expect(structured.json_ld).toEqual([{ '@type': 'Article', headline: 'Test' }]);
  });

  it('rejects a target that resolves to a private address (SSRF guard wired in)', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as never);
    await expect(
      CrawlClient.getInstance().fetch({ url: 'http://internal.example.test/', extract: 'text' }),
    ).rejects.toThrow(/private\/reserved/);
  });

  it('returns real, un-parsed body text for non-HTML content types', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        arrayBuffer: async () => new TextEncoder().encode('{"real":"data"}').buffer,
      }),
    );
    const result = await CrawlClient.getInstance().fetch({ url: 'https://public.example.test/data.json', extract: 'text' });
    expect(result.content).toBe('{"real":"data"}');
  });

  it('reports the real HTTP status the target returned rather than throwing on a 404', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 404,
        headers: new Headers({ 'content-type': 'text/html' }),
        arrayBuffer: async () => new TextEncoder().encode('<html><body>Not Found</body></html>').buffer,
      }),
    );
    const result = await CrawlClient.getInstance().fetch({ url: 'https://public.example.test/missing', extract: 'text' });
    expect(result.status_code).toBe(404);
    expect(result.content).toContain('Not Found');
  });
});
