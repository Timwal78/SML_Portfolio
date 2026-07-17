export interface XdeoEstimateParams {
  ticker: string;
  fiscalQuarter: string;
  estimateType: 'eps' | 'revenue' | 'guidance' | 'all';
}

export class XdeoClient {
  private static instance: XdeoClient;
  private readonly baseUrl: string;

  private constructor() {
    this.baseUrl = process.env['SML_API_BASE'] ?? 'https://api.scriptmasterlabs.com';
  }

  static getInstance(): XdeoClient {
    if (!XdeoClient.instance) {
      XdeoClient.instance = new XdeoClient();
    }
    return XdeoClient.instance;
  }

  async getEstimate(params: XdeoEstimateParams): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/xdeo/v1/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker: params.ticker,
        fiscal_quarter: params.fiscalQuarter,
        estimate_type: params.estimateType,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`xDEO API error: HTTP ${res.status}`);
    }

    return res.json();
  }
}
