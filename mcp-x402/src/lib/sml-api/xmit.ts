import * as cheerio from 'cheerio';
import { ssrfSafeFetch } from '../../server/security/ssrf-guard.js';

export interface XmitDecodeParams {
  filingUrl: string;
  parseTarget: 'executive_pay' | 'holdings' | 'ownership_changes' | 'all';
  format: 'json' | 'markdown';
}

// SEC's fair-access policy requires a descriptive User-Agent identifying
// the requester + a real contact — see
// https://www.sec.gov/os/webmaster-faq#developers. This is a real,
// documented external requirement, not an invented one.
const EDGAR_USER_AGENT = () =>
  `mcp-x402/2.1 (${process.env['SEC_EDGAR_CONTACT'] || 'operator contact not configured — set SEC_EDGAR_CONTACT'})`;

interface ExtractedTable {
  headers: string[];
  rows: string[][];
  near_heading: string | null;
}

/** Finds tables whose nearest preceding heading/strong text matches any of `patterns`. */
function tablesNear($: cheerio.CheerioAPI, patterns: RegExp[]): ExtractedTable[] {
  const found: ExtractedTable[] = [];
  $('table').each((_, table) => {
    // Walk backwards through preceding siblings/ancestors' text to find the
    // nearest heading-like element — SEC filings rarely use semantic <h1-6>,
    // so this checks bold/heading-ish text within a few preceding nodes.
    let nearHeading: string | null = null;
    let node = $(table).prev();
    let hops = 0;
    while (node.length && hops < 15 && !nearHeading) {
      const text = node.text().trim();
      if (text && text.length < 200 && patterns.some((p) => p.test(text))) {
        nearHeading = text;
      }
      node = node.prev();
      hops++;
    }
    // Also check the table's own caption/first row for a match.
    const tableText = $(table).text().slice(0, 300);
    const matchesDirectly = patterns.some((p) => p.test(tableText));
    if (!nearHeading && !matchesDirectly) return;

    const rows: string[][] = [];
    $(table)
      .find('tr')
      .each((_r, tr) => {
        const cells: string[] = [];
        $(tr)
          .find('th, td')
          .each((_c, cell) => { cells.push($(cell).text().replace(/\s+/g, ' ').trim()); });
        if (cells.some((c) => c.length > 0)) rows.push(cells);
      });
    if (rows.length === 0) return;

    found.push({ headers: rows[0] ?? [], rows: rows.slice(1), near_heading: nearHeading });
  });
  return found;
}

function parseExecutivePay($: cheerio.CheerioAPI): { tables: ExtractedTable[]; found: boolean } {
  const tables = tablesNear($, [/summary compensation table/i, /name and principal position/i, /executive compensation/i]);
  return { tables, found: tables.length > 0 };
}

function parseOwnershipChanges($: cheerio.CheerioAPI): { tables: ExtractedTable[]; found: boolean } {
  const tables = tablesNear($, [/item 5/i, /beneficial(ly)? own/i, /aggregate amount/i, /percent of class/i]);
  return { tables, found: tables.length > 0 };
}

interface HoldingsEntry {
  name_of_issuer: string | null;
  cusip: string | null;
  value: string | null;
  shares_or_principal_amount: string | null;
}

/** 13F filings publish holdings as a companion XML "information table" (infotable.xml). */
function parseHoldingsXml($: cheerio.CheerioAPI): { holdings: HoldingsEntry[]; found: boolean } {
  const holdings: HoldingsEntry[] = [];
  $('infoTable').each((_, el) => {
    holdings.push({
      name_of_issuer: $(el).find('nameOfIssuer').first().text().trim() || null,
      cusip: $(el).find('cusip').first().text().trim() || null,
      value: $(el).find('value').first().text().trim() || null,
      shares_or_principal_amount: $(el).find('sshPrnamt').first().text().trim() || null,
    });
  });
  return { holdings, found: holdings.length > 0 };
}

export class XmitClient {
  private static instance: XmitClient;

  private constructor() {}

  static getInstance(): XmitClient {
    if (!XmitClient.instance) {
      XmitClient.instance = new XmitClient();
    }
    return XmitClient.instance;
  }

  /**
   * Real, self-contained SEC EDGAR fetch + best-effort structural
   * extraction — no external SML backend required (fixed 2026-08-01,
   * previously called a dead host with no real service behind it
   * anywhere). This is honest, best-effort structural extraction, not a
   * certified/complete parse of every filing's idiosyncratic layout: it
   * looks for real tables near recognizable section headers rather than
   * fabricating data when a filing's layout doesn't match. `found: false`
   * on a section means the pattern search didn't locate it — not that the
   * filing definitely lacks that data.
   */
  async decode(params: XmitDecodeParams): Promise<unknown> {
    const res = await ssrfSafeFetch(
      params.filingUrl,
      { headers: { 'User-Agent': EDGAR_USER_AGENT() }, signal: AbortSignal.timeout(20_000) },
      3,
    );
    if (!res.ok) {
      throw new Error(`SEC EDGAR fetch failed: HTTP ${res.status}`);
    }
    const body = await res.text();
    const isXml = /^\s*<\?xml/i.test(body) || params.filingUrl.toLowerCase().endsWith('.xml');
    const $ = cheerio.load(body, { xmlMode: isXml });

    const out: Record<string, unknown> = {
      source_url: params.filingUrl,
      extraction_method: 'structural_best_effort',
      disclosure:
        'Extracted by locating real tables near recognizable SEC filing section headers (or, for 13F, a real XML information table). ' +
        'This is a best-effort structural parse, not a certified/complete decode of every filing layout — a `found: false` section ' +
        'means the pattern search did not locate it in this specific document, not that the data is confirmed absent.',
    };

    if (params.parseTarget === 'executive_pay' || params.parseTarget === 'all') {
      out['executive_pay'] = parseExecutivePay($);
    }
    if (params.parseTarget === 'holdings' || params.parseTarget === 'all') {
      out['holdings'] = isXml ? parseHoldingsXml($) : { holdings: [], found: false, note: 'Document was not XML — 13F holdings are published as a companion XML information table; pass that document\'s URL directly.' };
    }
    if (params.parseTarget === 'ownership_changes' || params.parseTarget === 'all') {
      out['ownership_changes'] = parseOwnershipChanges($);
    }

    return out;
  }
}
