import { EdgarClient } from './client';
import { EdgarParser } from './parser';
import type { Env } from '../types';
import { randomUUID } from './uuid';

const WATCHED_FORM_TYPES = ['13F-HR', '13D', '13G', 'SC 13D', 'SC 13G', '4', 'DEF 14A', '10-K', '8-K', '10-Q'];

export async function runEdgarCron(env: Env): Promise<void> {
  const client = new EdgarClient(env);
  const parser = new EdgarParser();

  const since = new Date(Date.now() - 2 * 60 * 1000).toISOString().split('T')[0];

  let filings;
  try {
    filings = await client.getRecentFilings(WATCHED_FORM_TYPES, since);
  } catch {
    return;
  }

  for (const filing of filings.slice(0, 50)) {
    const existing = await env.DB
      .prepare('SELECT accession_number FROM edgar_filings WHERE accession_number = ?')
      .bind(filing.accessionNumber)
      .first();
    if (existing) continue;

    await env.DB
      .prepare(`
        INSERT OR IGNORE INTO edgar_filings
          (accession_number, cik, form_type, filed_at, company_name, ticker, document_url, processed)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      `)
      .bind(
        filing.accessionNumber,
        filing.cik,
        filing.formType,
        filing.filedAt,
        filing.companyName,
        filing.ticker,
        filing.documentUrl
      )
      .run();

    if (filing.formType === '4') {
      try {
        const doc = await client.getFilingDocument(filing.accessionNumber, filing.cik);
        if (!doc) continue;
        const txns = parser.parseForm4(doc);
        for (const tx of txns) {
          if (!tx.issuerTicker) continue;
          const isSale = ['S', 'S-'].includes(tx.transactionCode);
          const isBuy = ['P', 'A'].includes(tx.transactionCode);
          if (!isSale && !isBuy) continue;

          const severity = tx.shares > 100000 ? 'HIGH' : tx.shares > 10000 ? 'MEDIUM' : 'LOW';
          await env.DB
            .prepare(`
              INSERT OR IGNORE INTO red_flags
                (id, ticker, company_name, severity, category, title, summary, evidence_urls, detected_at)
              VALUES (?, ?, ?, ?, 'INSIDER_TRADE', ?, ?, ?, ?)
            `)
            .bind(
              randomUUID(),
              tx.issuerTicker.toUpperCase(),
              tx.issuerName,
              severity,
              `${tx.reportingOwnerRelationship} ${isSale ? 'sold' : 'acquired'} ${tx.shares.toLocaleString()} shares`,
              `${tx.reportingOwnerName} (${tx.reportingOwnerRelationship}) filed Form 4 on ${tx.transactionDate}. ` +
                `Transaction code: ${tx.transactionCode}. Shares: ${tx.shares.toLocaleString()}. ` +
                `Following position: ${tx.sharesOwnedFollowing.toLocaleString()}.`,
              JSON.stringify([filing.documentUrl]),
              filing.filedAt
            )
            .run();
        }
      } catch {
        // Non-critical
      }
    }

    await env.DB
      .prepare('UPDATE edgar_filings SET processed = 1 WHERE accession_number = ?')
      .bind(filing.accessionNumber)
      .run();
  }
}
