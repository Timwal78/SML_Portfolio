import type { Env, InstitutionalFlow, Insight } from '../types';
import { EdgarClient } from '../edgar/client';
import { EdgarParser } from '../edgar/parser';
import { randomUUID } from '../edgar/uuid';

export class XIFDModule {
  private edgar: EdgarClient;
  private parser: EdgarParser;

  constructor(private env: Env) {
    this.edgar = new EdgarClient(env);
    this.parser = new EdgarParser();
  }

  async getFlowsForTicker(ticker: string, limit = 50): Promise<InstitutionalFlow[]> {
    const rows = await this.env.DB
      .prepare(`
        SELECT * FROM institutional_flows
        WHERE ticker = ?
        ORDER BY filed_at DESC
        LIMIT ?
      `)
      .bind(ticker.toUpperCase(), limit)
      .all<Record<string, unknown>>();

    return (rows.results ?? []).map(this.rowToFlow);
  }

  async getSentiment(ticker: string): Promise<'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNKNOWN'> {
    const rows = await this.env.DB
      .prepare(`
        SELECT action, COUNT(*) as cnt
        FROM institutional_flows
        WHERE ticker = ? AND filed_at >= datetime('now', '-90 days')
        GROUP BY action
      `)
      .bind(ticker.toUpperCase())
      .all<{ action: string; cnt: number }>();

    const counts: Record<string, number> = {};
    for (const r of rows.results ?? []) counts[r.action] = r.cnt;

    const bullish = (counts['NEW'] ?? 0) + (counts['INCREASED'] ?? 0);
    const bearish = (counts['DECREASED'] ?? 0) + (counts['EXITED'] ?? 0);

    if (bullish + bearish === 0) return 'UNKNOWN';
    const ratio = bullish / (bullish + bearish);
    if (ratio >= 0.65) return 'BULLISH';
    if (ratio <= 0.35) return 'BEARISH';
    return 'NEUTRAL';
  }

  async getWhaleMovers(limit = 20): Promise<Array<{
    ticker: string;
    institutionName: string;
    action: string;
    changePct: number | null;
    estimatedValueUsd: number | null;
    filedAt: string;
  }>> {
    const rows = await this.env.DB
      .prepare(`
        SELECT ticker, institution_name, action, change_pct, estimated_value_usd, filed_at
        FROM institutional_flows
        WHERE filed_at >= datetime('now', '-7 days')
          AND (action = 'NEW' OR action = 'EXITED' OR ABS(COALESCE(change_pct, 0)) >= 50)
        ORDER BY ABS(COALESCE(estimated_value_usd, 0)) DESC
        LIMIT ?
      `)
      .bind(limit)
      .all<{
        ticker: string;
        institution_name: string;
        action: string;
        change_pct: number | null;
        estimated_value_usd: number | null;
        filed_at: string;
      }>();

    return (rows.results ?? []).map((r) => ({
      ticker: r.ticker,
      institutionName: r.institution_name,
      action: r.action,
      changePct: r.change_pct,
      estimatedValueUsd: r.estimated_value_usd,
      filedAt: r.filed_at,
    }));
  }

  async ingest13F(
    cik: string,
    institutionName: string,
    accessionNumber: string,
    periodOfReport: string,
    filedAt: string
  ): Promise<number> {
    const doc = await this.edgar.getFilingDocument(accessionNumber, cik);
    if (!doc) return 0;

    const holdings = this.parser.parse13F(doc);
    let count = 0;

    // Get previous period holdings for comparison
    const prevRows = await this.env.DB
      .prepare(`
        SELECT ticker, current_shares
        FROM institutional_flows
        WHERE cik = ?
        ORDER BY filed_at DESC
        LIMIT 500
      `)
      .bind(cik)
      .all<{ ticker: string; current_shares: number }>();

    const prevMap: Record<string, number> = {};
    for (const r of prevRows.results ?? []) {
      if (!(r.ticker in prevMap)) prevMap[r.ticker] = r.current_shares;
    }

    for (const h of holdings) {
      const ticker = h.nameOfIssuer
        .replace(/[^A-Z]/gi, ' ')
        .trim()
        .split(/\s+/)[0]
        .toUpperCase()
        .slice(0, 5);

      if (!ticker) continue;

      const prev = prevMap[ticker] ?? null;
      const curr = h.shrsOrPrnAmt.sshPrnamt;
      let action: 'NEW' | 'INCREASED' | 'DECREASED' | 'EXITED' = 'INCREASED';
      let changePct: number | null = null;

      if (prev === null) { action = 'NEW'; }
      else if (curr === 0) { action = 'EXITED'; changePct = -100; }
      else {
        changePct = ((curr - prev) / prev) * 100;
        action = changePct >= 0 ? 'INCREASED' : 'DECREASED';
      }

      await this.env.DB
        .prepare(`
          INSERT OR IGNORE INTO institutional_flows
            (id, institution_name, cik, ticker, period_of_report,
             previous_shares, current_shares, change_pct, action,
             estimated_value_usd, filed_at, form_13f_accession)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          randomUUID(), institutionName, cik, ticker, periodOfReport,
          prev, curr, changePct, action,
          h.value || null, filedAt, accessionNumber
        )
        .run();
      count++;
    }

    return count;
  }

  async submitFlowInsight(
    analystAddress: string,
    ticker: string,
    title: string,
    summary: string,
    priceMicro: number,
    confidenceScore: number
  ): Promise<Insight> {
    await this.ensureAnalyst(analystAddress);
    const id = randomUUID();

    await this.env.DB
      .prepare(`
        INSERT INTO insights
          (id, analyst_address, module, ticker, title, summary,
           confidence_score, price_micro, payment_address, submitted_at)
        VALUES (?, ?, 'xifd', ?, ?, ?, ?, ?, ?, datetime('now'))
      `)
      .bind(id, analystAddress, ticker.toUpperCase(), title, summary,
            confidenceScore, priceMicro, analystAddress)
      .run();

    return {
      id,
      analystAddress,
      module: 'xifd',
      ticker: ticker.toUpperCase(),
      title,
      summary,
      confidenceScore,
      priceMicro,
      paymentAddress: analystAddress,
      edgarFilingId: null,
      edgarFormType: '13F-HR',
      evidenceHash: null,
      submittedAt: new Date().toISOString(),
      scoredAt: null,
      outcomeVerdict: 'PENDING',
      reputationDelta: null,
      viewCount: 0,
      purchaseCount: 0,
    };
  }

  private rowToFlow(row: Record<string, unknown>): InstitutionalFlow {
    return {
      institutionName: row.institution_name as string,
      cik: row.cik as string,
      ticker: row.ticker as string,
      periodOfReport: row.period_of_report as string,
      previousShares: row.previous_shares as number | null,
      currentShares: row.current_shares as number,
      changePct: row.change_pct as number | null,
      action: row.action as InstitutionalFlow['action'],
      estimatedValueUsd: row.estimated_value_usd as number | null,
      filedAt: row.filed_at as string,
      form13FAccession: row.form_13f_accession as string,
    };
  }

  private async ensureAnalyst(address: string) {
    await this.env.DB
      .prepare(`INSERT OR IGNORE INTO analysts (address) VALUES (?)`)
      .bind(address)
      .run();
  }
}
