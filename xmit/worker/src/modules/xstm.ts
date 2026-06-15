import type { Env, RedFlagReport, Insight } from '../types';
import { randomUUID } from '../edgar/uuid';

export class XSTMModule {
  constructor(private env: Env) {}

  async getRedFlags(
    ticker: string,
    severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  ): Promise<RedFlagReport[]> {
    let query = 'SELECT * FROM red_flags WHERE ticker = ? ORDER BY detected_at DESC LIMIT 50';
    let params: unknown[] = [ticker.toUpperCase()];

    if (severity) {
      query = 'SELECT * FROM red_flags WHERE ticker = ? AND severity = ? ORDER BY detected_at DESC LIMIT 50';
      params = [ticker.toUpperCase(), severity];
    }

    const rows = await this.env.DB.prepare(query).bind(...params).all<Record<string, unknown>>();
    return (rows.results ?? []).map(this.rowToRedFlag);
  }

  async getAllRedFlagsByTicker(): Promise<Record<string, number>> {
    const rows = await this.env.DB
      .prepare(`
        SELECT ticker, COUNT(*) as count,
               SUM(CASE WHEN severity IN ('HIGH', 'CRITICAL') THEN 1 ELSE 0 END) as severe_count
        FROM red_flags
        WHERE resolution_status = 'OPEN'
        GROUP BY ticker
        ORDER BY severe_count DESC, count DESC
        LIMIT 100
      `)
      .all<{ ticker: string; count: number; severe_count: number }>();

    const result: Record<string, number> = {};
    for (const row of rows.results ?? []) {
      result[row.ticker] = row.count;
    }
    return result;
  }

  async submitThesis(
    analystAddress: string,
    ticker: string,
    title: string,
    summary: string,
    evidenceUrls: string[],
    confidenceScore: number,
    priceMicro: number,
    category: RedFlagReport['category']
  ): Promise<{ insight: Insight; flagId: string }> {
    await this.ensureAnalyst(analystAddress);
    const insightId = randomUUID();
    const flagId = randomUUID();

    await this.env.DB
      .prepare(`
        INSERT INTO insights
          (id, analyst_address, module, ticker, title, summary, confidence_score,
           price_micro, payment_address, submitted_at)
        VALUES (?, ?, 'xstm', ?, ?, ?, ?, ?, ?, datetime('now'))
      `)
      .bind(insightId, analystAddress, ticker.toUpperCase(), title, summary,
            confidenceScore, priceMicro, analystAddress)
      .run();

    await this.env.DB
      .prepare(`
        INSERT INTO red_flags
          (id, ticker, company_name, severity, category, title, summary, evidence_urls, detected_at)
        VALUES (?, ?, ?, 'MEDIUM', ?, ?, ?, ?, datetime('now'))
      `)
      .bind(flagId, ticker.toUpperCase(), ticker.toUpperCase(), category,
            title, summary, JSON.stringify(evidenceUrls))
      .run();

    return {
      flagId,
      insight: {
        id: insightId,
        analystAddress,
        module: 'xstm',
        ticker: ticker.toUpperCase(),
        title,
        summary,
        confidenceScore,
        priceMicro,
        paymentAddress: analystAddress,
        edgarFilingId: null,
        edgarFormType: null,
        evidenceHash: null,
        submittedAt: new Date().toISOString(),
        scoredAt: null,
        outcomeVerdict: 'PENDING',
        reputationDelta: null,
        viewCount: 0,
        purchaseCount: 0,
      },
    };
  }

  async getTopShortCandidates(limit = 20): Promise<Array<{
    ticker: string;
    totalFlags: number;
    criticalFlags: number;
    recentActivity: string;
  }>> {
    const rows = await this.env.DB
      .prepare(`
        SELECT
          ticker,
          COUNT(*) as total_flags,
          SUM(CASE WHEN severity IN ('HIGH', 'CRITICAL') THEN 1 ELSE 0 END) as critical_flags,
          MAX(detected_at) as recent_activity
        FROM red_flags
        WHERE resolution_status = 'OPEN'
        GROUP BY ticker
        ORDER BY critical_flags DESC, total_flags DESC
        LIMIT ?
      `)
      .bind(limit)
      .all<{ ticker: string; total_flags: number; critical_flags: number; recent_activity: string }>();

    return (rows.results ?? []).map((r) => ({
      ticker: r.ticker,
      totalFlags: r.total_flags,
      criticalFlags: r.critical_flags,
      recentActivity: r.recent_activity,
    }));
  }

  private rowToRedFlag(row: Record<string, unknown>): RedFlagReport {
    return {
      id: row.id as string,
      ticker: row.ticker as string,
      companyName: row.company_name as string,
      severity: row.severity as RedFlagReport['severity'],
      category: row.category as RedFlagReport['category'],
      title: row.title as string,
      summary: row.summary as string,
      evidenceUrls: JSON.parse((row.evidence_urls as string) || '[]') as string[],
      detectedAt: row.detected_at as string,
      resolutionStatus: row.resolution_status as RedFlagReport['resolutionStatus'],
    };
  }

  private async ensureAnalyst(address: string) {
    await this.env.DB
      .prepare(`INSERT OR IGNORE INTO analysts (address) VALUES (?)`)
      .bind(address)
      .run();
  }
}
