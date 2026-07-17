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

export class CrawlClient {
  private static instance: CrawlClient;
  private readonly baseUrl: string;

  private constructor() {
    this.baseUrl = process.env['SML_API_BASE'] ?? 'https://api.scriptmasterlabs.com';
  }

  static getInstance(): CrawlClient {
    if (!CrawlClient.instance) {
      CrawlClient.instance = new CrawlClient();
    }
    return CrawlClient.instance;
  }

  async fetch(params: CrawlParams): Promise<CrawlResult> {
    const res = await fetch(`${this.baseUrl}/crawl/v1/fetch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(params.userAgent ? { 'X-Crawl-User-Agent': params.userAgent } : {}),
      },
      body: JSON.stringify({ url: params.url, extract: params.extract }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) throw new Error(`Crawl API error: HTTP ${res.status}`);
    return res.json() as Promise<CrawlResult>;
  }
}
