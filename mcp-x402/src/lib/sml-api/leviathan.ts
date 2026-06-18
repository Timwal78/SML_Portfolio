export interface LeviathanSignalParams {
  ticker?: string;
  signalType: 'squeeze' | 'momentum' | 'dark_pool' | 'all';
  minConfidence: number;
}

export interface LeviathanSignal {
  ticker: string;
  signal_type: string;
  confidence: number;
  directive: string;
  regime: string;
  timestamp: string;
  source: string;
}

export class LeviathanClient {
  private static instance: LeviathanClient;
  private readonly baseUrl: string;

  private constructor() {
    this.baseUrl = process.env['SML_API_BASE'] ?? 'https://api.scriptmasterlabs.com';
  }

  static getInstance(): LeviathanClient {
    if (!LeviathanClient.instance) {
      LeviathanClient.instance = new LeviathanClient();
    }
    return LeviathanClient.instance;
  }

  async getSignal(params: LeviathanSignalParams): Promise<LeviathanSignal[]> {
    const qs = new URLSearchParams({
      signal_type: params.signalType,
      min_confidence: String(params.minConfidence),
    });
    if (params.ticker) qs.set('ticker', params.ticker);

    const res = await fetch(`${this.baseUrl}/leviathan/v1/signal?${qs.toString()}`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`Leviathan API error: HTTP ${res.status}`);
    }

    return (await res.json()) as LeviathanSignal[];
  }
}
