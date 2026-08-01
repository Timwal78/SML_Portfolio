import * as cheerio from 'cheerio';
import { ssrfSafeFetch } from '../../server/security/ssrf-guard.js';

export interface CrawlParams {
  url: string;
  extract: 'text' | 'links' | 'tables' | 'structured' | 'all';
  userAgent?: string;
}

export interface CrawlResult {
  url: string;
  content: string | unknown;
  status_code: number;
  content_type: string;
  fetched_at: string;
}

const MAX_RESPONSE_BYTES = 5_000_000; // 5MB cap — same order of magnitude as a typical page
const DEFAULT_USER_AGENT = 'CrawlPaidFetch/1.0 (+https://www.scriptmasterlabs.com/mcp-x402)';

function extractText($: cheerio.CheerioAPI): string {
  $('script, style, noscript').remove();
  return $('body').text().replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function extractLinks($: cheerio.CheerioAPI, baseUrl: string): Array<{ href: string; text: string }> {
  const links: Array<{ href: string; text: string }> = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const absolute = new URL(href, baseUrl).toString();
      links.push({ href: absolute, text: $(el).text().trim().slice(0, 200) });
    } catch {
      // not a resolvable URL (e.g. "javascript:void(0)") — skip rather than fabricate one
    }
  });
  return links;
}

function extractTables($: cheerio.CheerioAPI): string[][][] {
  const tables: string[][][] = [];
  $('table').each((_, table) => {
    const rows: string[][] = [];
    $(table)
      .find('tr')
      .each((_r, tr) => {
        const cells: string[] = [];
        $(tr)
          .find('th, td')
          .each((_c, cell) => { cells.push($(cell).text().trim()); });
        if (cells.length > 0) rows.push(cells);
      });
    if (rows.length > 0) tables.push(rows);
  });
  return tables;
}

function extractStructured($: cheerio.CheerioAPI): Record<string, unknown> {
  const jsonLd: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      jsonLd.push(JSON.parse($(el).text()));
    } catch {
      // malformed JSON-LD on the page — skip it rather than guess its content
    }
  });

  const meta: Record<string, string> = {};
  $('meta[property], meta[name]').each((_, el) => {
    const key = $(el).attr('property') || $(el).attr('name');
    const content = $(el).attr('content');
    if (key && content) meta[key] = content;
  });

  const headings: string[] = [];
  $('h1, h2, h3').each((_, el) => { headings.push($(el).text().trim()); });

  return {
    title: $('title').first().text().trim() || null,
    meta,
    headings,
    json_ld: jsonLd,
  };
}

export class CrawlClient {
  private static instance: CrawlClient;

  private constructor() {}

  static getInstance(): CrawlClient {
    if (!CrawlClient.instance) {
      CrawlClient.instance = new CrawlClient();
    }
    return CrawlClient.instance;
  }

  /**
   * Real, self-contained fetch-and-extract — no external SML backend
   * required (the previous implementation called
   * api.scriptmasterlabs.com/crawl/v1/fetch, a host with no real service
   * behind it anywhere in this account's infrastructure; fixed 2026-08-01).
   * SSRF-guarded via ssrfSafeFetch: the target (and every redirect hop) is
   * resolved and checked against private/reserved IP ranges before being
   * requested — a paid "fetch any URL" tool is a real SSRF surface and
   * must not be able to reach internal infrastructure or cloud metadata.
   */
  async fetch(params: CrawlParams): Promise<CrawlResult> {
    const res = await ssrfSafeFetch(
      params.url,
      {
        headers: { 'User-Agent': params.userAgent || DEFAULT_USER_AGENT },
        signal: AbortSignal.timeout(20_000),
      },
      5,
    );

    const contentType = res.headers.get('content-type') || '';
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_RESPONSE_BYTES) {
      throw new Error(`Response too large (${buf.byteLength} bytes, max ${MAX_RESPONSE_BYTES})`);
    }
    const body = Buffer.from(buf).toString('utf-8');

    let content: string | unknown;
    if (contentType.includes('html')) {
      const $ = cheerio.load(body);
      switch (params.extract) {
        case 'text':
          content = extractText($);
          break;
        case 'links':
          content = extractLinks($, params.url);
          break;
        case 'tables':
          content = extractTables($);
          break;
        case 'structured':
          content = extractStructured($);
          break;
        case 'all':
        default:
          content = {
            text: extractText($),
            links: extractLinks($, params.url),
            tables: extractTables($),
            structured: extractStructured($),
          };
          break;
      }
    } else {
      // Non-HTML (JSON, plain text, etc.) — return the real body as-is
      // rather than running an HTML parser over it.
      content = body.slice(0, 50_000);
    }

    return {
      url: params.url,
      content,
      status_code: res.status,
      content_type: contentType || 'unknown',
      fetched_at: new Date().toISOString(),
    };
  }
}
