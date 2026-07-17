export type LeviathanSignalType = 'squeeze' | 'momentum' | 'all';

export interface LeviathanSignalParams {
  ticker: string;
  signalType: LeviathanSignalType;
}

export interface LeviathanSignal {
  symbol: string;
  signal: string;
  squeeze_alert?: boolean;
  source: string;
  timestamp: string;
  [key: string]: unknown;
}

const SIGNAL_PATH: Record<LeviathanSignalType, string> = {
  squeeze:  '/api/signals/741',
  momentum: '/api/signals/365',
  all:      '/api/signals/full',
};

export class LeviathanClient {
  private static instance: LeviathanClient;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  private constructor() {
    this.baseUrl = (
      process.env['SQUEEZEOS_API_BASE'] ??
      process.env['SML_API_BASE'] ??
      'https://squeezeos-api.onrender.com'
    ).replace(/\/$/, '');
    this.apiKey = process.env['SML_API_KEY'] ?? '';
  }

  static getInstance(): LeviathanClient {
    if (!LeviathanClient.instance) {
      LeviathanClient.instance = new LeviathanClient();
    }
    return LeviathanClient.instance;
  }

  async getSignal(params: LeviathanSignalParams): Promise<LeviathanSignal> {
    const path = SIGNAL_PATH[params.signalType];
    const url = `${this.baseUrl}${path}/${encodeURIComponent(params.ticker.toUpperCase())}`;

    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;

    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`SqueezeOS signal API error: HTTP ${res.status}${body ? ` — ${body}` : ''}`);
    }

    return (await res.json()) as LeviathanSignal;
  }
}
