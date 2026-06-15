import type { Env, GovernanceScore, Insight } from '../types';
import { EdgarClient } from '../edgar/client';
import { EdgarParser } from '../edgar/parser';
import { randomUUID } from '../edgar/uuid';

export class XCGOModule {
  private edgar: EdgarClient;
  private parser: EdgarParser;

  constructor(private env: Env) {
    this.edgar = new EdgarClient(env);
    this.parser = new EdgarParser();
  }

  async getGovernanceScore(ticker: string): Promise<GovernanceScore | null> {
    const row = await this.env.DB
      .prepare('SELECT * FROM governance_scores WHERE ticker = ?')
      .bind(ticker.toUpperCase())
      .first<Record<string, unknown>>();

    if (row) {
      return {
        ticker: row.ticker as string,
        companyName: row.company_name as string,
        overallGrade: row.overall_grade as string,
        score: row.score as number,
        boardIndependence: row.board_independence as number,
        ceoPayRatio: row.ceo_pay_ratio as number | null,
        auditCommitteeScore: row.audit_committee_score as number,
        redFlagCount: row.red_flag_count as number,
        proxyFilingDate: row.proxy_filing_date as string,
        meetingDate: row.meeting_date as string | null,
        analystConsensus: row.analyst_consensus as GovernanceScore['analystConsensus'],
        keyIssues: JSON.parse((row.key_issues as string) || '[]') as string[],
      };
    }

    return this.fetchAndComputeGovernance(ticker);
  }

  private async fetchAndComputeGovernance(ticker: string): Promise<GovernanceScore | null> {
    const cik = await this.edgar.searchByTicker(ticker);
    if (!cik) return null;

    const submissions = await this.edgar.getCompanySubmissions(cik);
    if (!submissions) return null;

    const recentForms = submissions.filings.recent;
    const proxyIdx = recentForms.form.findIndex((f) => f === 'DEF 14A');

    let proxy = null;
    if (proxyIdx >= 0) {
      const accession = recentForms.accessionNumber[proxyIdx];
      const doc = await this.edgar.getFilingDocument(accession, cik);
      if (doc) proxy = this.parser.parseDefProxy(doc);
    }

    const { grade, score, redFlagCount } = proxy
      ? this.parser.scoreGovernance(proxy)
      : { grade: 'N/A', score: 50, redFlagCount: 0 };

    const result: GovernanceScore = {
      ticker: ticker.toUpperCase(),
      companyName: proxy?.companyName ?? submissions.name,
      overallGrade: grade,
      score,
      boardIndependence: 0,
      ceoPayRatio: null,
      auditCommitteeScore: 0,
      redFlagCount,
      proxyFilingDate: proxyIdx >= 0 ? recentForms.filingDate[proxyIdx] : 'N/A',
      meetingDate: proxy?.meetingDate ?? null,
      analystConsensus: 'SPLIT',
      keyIssues: [],
    };

    await this.env.DB
      .prepare(`
        INSERT OR REPLACE INTO governance_scores
          (ticker, company_name, overall_grade, score, board_independence,
           ceo_pay_ratio, audit_committee_score, red_flag_count,
           proxy_filing_date, meeting_date, analyst_consensus, key_issues, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `)
      .bind(
        result.ticker, result.companyName, result.overallGrade, result.score,
        result.boardIndependence, result.ceoPayRatio, result.auditCommitteeScore,
        result.redFlagCount, result.proxyFilingDate, result.meetingDate,
        result.analystConsensus, JSON.stringify(result.keyIssues)
      )
      .run();

    return result;
  }

  async submitVoteRecommendation(
    analystAddress: string,
    ticker: string,
    recommendation: 'VOTE_FOR' | 'VOTE_AGAINST' | 'ABSTAIN',
    title: string,
    summary: string,
    priceMicro: number
  ): Promise<Insight> {
    const id = randomUUID();
    const insight: Insight = {
      id,
      analystAddress,
      module: 'xcgo',
      ticker: ticker.toUpperCase(),
      title,
      summary,
      confidenceScore: 70,
      priceMicro,
      paymentAddress: analystAddress,
      edgarFilingId: null,
      edgarFormType: 'DEF 14A',
      evidenceHash: null,
      submittedAt: new Date().toISOString(),
      scoredAt: null,
      outcomeVerdict: 'PENDING',
      reputationDelta: null,
      viewCount: 0,
      purchaseCount: 0,
    };

    await this.env.DB
      .prepare(`
        INSERT INTO insights
          (id, analyst_address, module, ticker, title, summary, confidence_score,
           price_micro, payment_address, edgar_form_type, submitted_at)
        VALUES (?, ?, 'xcgo', ?, ?, ?, ?, ?, ?, 'DEF 14A', datetime('now'))
      `)
      .bind(id, analystAddress, insight.ticker, title, summary,
            insight.confidenceScore, priceMicro, analystAddress)
      .run();

    await this.ensureAnalyst(analystAddress);
    return insight;
  }

  private async ensureAnalyst(address: string) {
    await this.env.DB
      .prepare(`INSERT OR IGNORE INTO analysts (address) VALUES (?)`)
      .bind(address)
      .run();
  }
}
