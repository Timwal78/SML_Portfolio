import type { Env } from '../types';

const EDGAR_HEADERS = {
  'User-Agent': 'xMIT-Platform contact@xmit.finance',
  'Accept-Encoding': 'gzip, deflate',
};

export interface EdgarSubmissionResponse {
  cik: string;
  entityType: string;
  sic: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      form: string[];
      primaryDocument: string[];
      primaryDocDescription: string[];
    };
  };
}

export interface EdgarFullTextResult {
  hits: {
    hits: Array<{
      _id: string;
      _source: {
        period_of_report: string;
        entity_name: string;
        file_date: string;
        form_type: string;
        biz_location: string;
      };
    }>;
    total: { value: number };
  };
}

export class EdgarClient {
  private baseUrl: string;

  constructor(env: Env) {
    this.baseUrl = env.EDGAR_BASE_URL || 'https://data.sec.gov';
  }

  async getRecentFilings(
    formTypes: string[],
    sinceDate?: string
  ): Promise<Array<{
    accessionNumber: string;
    cik: string;
    companyName: string;
    ticker: string | null;
    formType: string;
    filedAt: string;
    documentUrl: string;
  }>> {
    const dateStr = sinceDate ?? new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const results: Array<{
      accessionNumber: string;
      cik: string;
      companyName: string;
      ticker: string | null;
      formType: string;
      filedAt: string;
      documentUrl: string;
    }> = [];

    for (const formType of formTypes) {
      try {
        const url = `${this.baseUrl}/submissions/CIK0000000000.json`;
        // Use EDGAR full-text search for recent filings
        const searchUrl = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(formType)}%22&dateRange=custom&startdt=${dateStr}&forms=${encodeURIComponent(formType)}&_source=period_of_report,entity_name,file_date,form_type`;
        const resp = await fetch(searchUrl, { headers: EDGAR_HEADERS });
        if (!resp.ok) continue;
        const data = (await resp.json()) as EdgarFullTextResult;

        for (const hit of data.hits?.hits ?? []) {
          const accessionRaw = hit._id.replace(/[^0-9-]/g, '');
          const cik = accessionRaw.split('-')[0];
          results.push({
            accessionNumber: hit._id,
            cik,
            companyName: hit._source.entity_name ?? 'Unknown',
            ticker: null,
            formType: hit._source.form_type ?? formType,
            filedAt: hit._source.file_date ?? dateStr,
            documentUrl: `https://www.sec.gov/Archives/edgar/data/${cik}/${hit._id.replace(/-/g, '')}/`,
          });
        }
      } catch {
        // Continue with next form type
      }
    }

    return results;
  }

  async getCompanySubmissions(cik: string): Promise<EdgarSubmissionResponse | null> {
    const paddedCik = cik.padStart(10, '0');
    const url = `${this.baseUrl}/submissions/CIK${paddedCik}.json`;
    try {
      const resp = await fetch(url, { headers: EDGAR_HEADERS });
      if (!resp.ok) return null;
      return (await resp.json()) as EdgarSubmissionResponse;
    } catch {
      return null;
    }
  }

  async getFilingDocument(accessionNumber: string, cik: string): Promise<string | null> {
    const cleanAccession = accessionNumber.replace(/-/g, '');
    const primaryUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${cleanAccession}/`;
    try {
      const indexResp = await fetch(`${primaryUrl}${cleanAccession}-index.json`, {
        headers: EDGAR_HEADERS,
      });
      if (!indexResp.ok) return null;
      const index = (await indexResp.json()) as { documents: Array<{ name: string; type: string }> };
      const primary = index.documents?.find(
        (d) => d.type === 'primary_doc' || d.name?.endsWith('.xml') || d.name?.endsWith('.htm')
      );
      if (!primary) return null;
      const docResp = await fetch(`${primaryUrl}${primary.name}`, { headers: EDGAR_HEADERS });
      if (!docResp.ok) return null;
      return docResp.text();
    } catch {
      return null;
    }
  }

  async searchByTicker(ticker: string): Promise<string | null> {
    try {
      const resp = await fetch(`https://www.sec.gov/cgi-bin/browse-edgar?company=&CIK=${ticker}&type=&dateb=&owner=include&count=10&search_text=&action=getcompany&output=atom`, {
        headers: EDGAR_HEADERS,
      });
      if (!resp.ok) return null;
      const text = await resp.text();
      const match = text.match(/\/cgi-bin\/browse-edgar\?action=getcompany&CIK=(\d+)/);
      return match?.[1] ?? null;
    } catch {
      return null;
    }
  }

  async getCompanyFacts(cik: string): Promise<Record<string, unknown> | null> {
    const paddedCik = cik.padStart(10, '0');
    try {
      const resp = await fetch(`${this.baseUrl}/api/xbrl/companyfacts/CIK${paddedCik}.json`, {
        headers: EDGAR_HEADERS,
      });
      if (!resp.ok) return null;
      return resp.json() as Promise<Record<string, unknown>>;
    } catch {
      return null;
    }
  }
}
