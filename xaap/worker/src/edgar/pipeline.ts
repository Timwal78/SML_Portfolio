import type { Env } from '../types/index.js';
import { detectRedFlags } from './forensics.js';

const EDGAR_BASE = 'https://data.sec.gov';
const SUBMISSIONS_BASE = 'https://data.sec.gov/submissions';
const HIGH_PRIORITY_FORMS = ['10-K', '10-Q', '8-K', '13D', 'DEF 14A', 'SC 13G/A'];

interface EdgarFilingEntry {
  accessionNumber: string;
  filingDate: string;
  reportDate: string;
  form: string;
  primaryDocument: string;
  cik?: string;
}

export async function runEdgarPipeline(env: Env): Promise<void> {
  const ua = env.EDGAR_USER_AGENT || 'xAAP/1.0 contact@scriptmasterlabs.com';

  // 1. Fetch today's full-text index from EDGAR
  const today = new Date();
  const year = today.getUTCFullYear();
  const quarter = Math.ceil((today.getUTCMonth() + 1) / 3);

  try {
    const indexUrl = `https://www.sec.gov/Archives/edgar/full-index/${year}/QTR${quarter}/company.idx`;
    const resp = await fetch(indexUrl, {
      headers: { 'User-Agent': ua, 'Accept-Encoding': 'gzip' },
    });
    if (!resp.ok) return;

    const text = await resp.text();
    const lines = text.split('\n').slice(9); // skip header

    const recentCutoff = Date.now() / 1000 - 3600; // last hour
    const newFilings: EdgarFilingEntry[] = [];

    for (const line of lines) {
      // Format: Company Name | Form Type | CIK | Date Filed | Filename
      const parts = line.split('|');
      if (parts.length < 5) continue;
      const [, formType, cikRaw, dateStr, filename] = parts;
      if (!formType || !HIGH_PRIORITY_FORMS.includes(formType.trim())) continue;

      const filingDate = new Date(dateStr?.trim() ?? '').getTime() / 1000;
      if (isNaN(filingDate) || filingDate < recentCutoff) continue;

      const cik = cikRaw?.trim().padStart(10, '0');
      const accession = filename?.trim().replace('.txt', '').split('/').pop() ?? '';

      // Check if already processed
      const existing = await env.DB.prepare(
        'SELECT accession_number FROM filings WHERE accession_number = ?'
      ).bind(accession).first();
      if (existing) continue;

      newFilings.push({
        accessionNumber: accession,
        filingDate: dateStr?.trim() ?? '',
        reportDate: dateStr?.trim() ?? '',
        form: formType.trim(),
        primaryDocument: filename?.trim() ?? '',
        cik,
      });
    }

    // 2. Process each new filing
    for (const filing of newFilings.slice(0, 20)) { // max 20 per cron run
      await processFilingEntry(filing, env, ua);
    }
  } catch (err) {
    console.error('EDGAR pipeline error:', err);
  }
}

async function processFilingEntry(filing: EdgarFilingEntry, env: Env, ua: string) {
  const cik = filing.cik ?? '';
  const accession = filing.accessionNumber;
  const filingDateTs = Math.floor(new Date(filing.filingDate).getTime() / 1000);

  // Insert filing record
  await env.DB.prepare(
    `INSERT INTO filings (accession_number, cik, form_type, filing_date, processing_status)
     VALUES (?, ?, ?, ?, 'PROCESSING')
     ON CONFLICT(accession_number) DO NOTHING`
  ).bind(accession, cik, filing.form, filingDateTs).run();

  try {
    // Resolve CIK to ticker
    const ticker = await resolveTickerFromCik(cik, env, ua);
    if (ticker) {
      await env.DB.prepare(
        'UPDATE filings SET ticker = ? WHERE accession_number = ?'
      ).bind(ticker, accession).run();
    }

    // Fetch filing document
    const docUrl = `https://www.sec.gov/Archives/edgar/${filing.primaryDocument}`;
    const docResp = await fetch(docUrl, { headers: { 'User-Agent': ua } });
    if (!docResp.ok) throw new Error(`Failed to fetch document: ${docResp.status}`);
    const docText = await docResp.text();

    // Run forensic analysis
    const redFlags = detectRedFlags(docText, filing.form as any, accession);
    const forensicScore = computeForensicScore(redFlags);

    // Update filing
    await env.DB.prepare(
      `UPDATE filings SET
         processing_status = 'COMPLETE',
         red_flags_json = ?,
         forensic_score = ?,
         processed_at = unixepoch()
       WHERE accession_number = ?`
    ).bind(JSON.stringify(redFlags), forensicScore, accession).run();

    // Update ticker health score if we have a ticker
    if (ticker) {
      await updateTickerHealthScore(ticker, env);
    }

    // Auto-generate system finding if critical flags found
    const criticalFlags = redFlags.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH');
    if (criticalFlags.length >= 3 && ticker) {
      await autoGenerateFinding(ticker, accession, filing.form, criticalFlags, env);
    }
  } catch (err) {
    await env.DB.prepare(
      `UPDATE filings SET processing_status = 'ERROR' WHERE accession_number = ?`
    ).bind(accession).run();
    console.error(`Error processing filing ${accession}:`, err);
  }
}

async function resolveTickerFromCik(cik: string, env: Env, ua: string): Promise<string | null> {
  const cacheKey = `cik:${cik}`;
  const cached = await env.CACHE.get(cacheKey);
  if (cached) return cached;

  try {
    const resp = await fetch(`${SUBMISSIONS_BASE}/CIK${cik}.json`, {
      headers: { 'User-Agent': ua },
    });
    if (!resp.ok) return null;
    const data = await resp.json<{ tickers?: string[] }>();
    const ticker = data.tickers?.[0] ?? null;
    if (ticker) {
      await env.CACHE.put(cacheKey, ticker, { expirationTtl: 86400 });
      // Upsert ticker
      const entityData = data as any;
      await env.DB.prepare(
        `INSERT INTO tickers (symbol, company_name, cik, sector)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(symbol) DO UPDATE SET cik = excluded.cik, company_name = excluded.company_name`
      ).bind(
        ticker.toUpperCase(),
        entityData.name ?? ticker,
        cik,
        entityData.sic ?? null
      ).run();
    }
    return ticker;
  } catch {
    return null;
  }
}

function computeForensicScore(redFlags: Array<{ severity: string }>): number {
  let score = 0;
  for (const flag of redFlags) {
    score += flag.severity === 'CRITICAL' ? 25 : flag.severity === 'HIGH' ? 10 : flag.severity === 'MEDIUM' ? 4 : 1;
  }
  return Math.min(score, 100);
}

async function updateTickerHealthScore(ticker: string, env: Env) {
  const row = await env.DB.prepare(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN severity IN ('HIGH','CRITICAL') THEN 1 ELSE 0 END) as severe
     FROM findings WHERE ticker = ? AND status != 'INVALIDATED'`
  ).bind(ticker).first<{ total: number; severe: number }>();

  const total = row?.total ?? 0;
  const severe = row?.severe ?? 0;
  const score = Math.max(0, 100 - (total * 5) - (severe * 15));
  const grade =
    score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B' :
    score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';

  await env.DB.prepare(
    `UPDATE tickers SET health_score = ?, health_grade = ?, red_flag_count = ?, severe_flag_count = ?, last_scored_at = unixepoch()
     WHERE symbol = ?`
  ).bind(score, grade, total, severe, ticker).run();
}

async function autoGenerateFinding(
  ticker: string, accession: string, formType: string,
  flags: Array<{ type: string; severity: string; description: string; evidence_snippet: string }>,
  env: Env
) {
  const SYSTEM_ADDRESS = '0x0000000000000000000000000000000000000001';
  await env.DB.prepare(
    `INSERT OR IGNORE INTO auditors (address, display_name, tier)
     VALUES (?, 'xAAP System', 'AUDITOR')`
  ).bind(SYSTEM_ADDRESS).run();

  const title = `[AUTO] ${flags.length} forensic signals detected in ${ticker} ${formType}`;
  const summary = flags.slice(0, 3).map(f => `• ${f.type}: ${f.description}`).join('\n');

  await env.DB.prepare(
    `INSERT INTO findings
       (id, ticker, auditor_address, title, summary, severity, category,
        price_usdc, status, filing_accession, filing_type)
     VALUES (?,?,?,?,?,'HIGH','OTHER','0','PENDING',?,?)`
  ).bind(
    crypto.randomUUID(), ticker, SYSTEM_ADDRESS, title, summary,
    accession, formType
  ).run();
}
