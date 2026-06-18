export interface FtdAlertParams {
  ticker?: string;
  minSpikeMultiplier: number;
}

export interface FtdScanParams {
  ticker?: string;
  scanType: 'full' | 'spike_history';
  minSpikeMultiplier: number;
}

export class FtdClient {
  private static instance: FtdClient;
  private readonly baseUrl: string;

  private constructor() {
    this.baseUrl = process.env['SML_API_BASE'] ?? 'https://api.scriptmasterlabs.com';
  }

  static getInstance(): FtdClient {
    if (!FtdClient.instance) {
      FtdClient.instance = new FtdClient();
    }
    return FtdClient.instance;
  }

  async getAlerts(params: FtdAlertParams): Promise<unknown> {
    const qs = new URLSearchParams({ min_spike: String(params.minSpikeMultiplier) });
    if (params.ticker) qs.set('ticker', params.ticker);

    const res = await fetch(`${this.baseUrl}/ftd/v1/alerts?${qs.toString()}`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) throw new Error(`FTD API error: HTTP ${res.status}`);
    return res.json();
  }

  async getFullScan(params: FtdScanParams): Promise<unknown> {
    const qs = new URLSearchParams({
      scan_type: params.scanType,
      min_spike: String(params.minSpikeMultiplier),
    });
    if (params.ticker) qs.set('ticker', params.ticker);

    const res = await fetch(`${this.baseUrl}/ftd/v1/scan?${qs.toString()}`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) throw new Error(`FTD API error: HTTP ${res.status}`);
    return res.json();
  }
}
