export interface XmitDecodeParams {
  filingUrl: string;
  parseTarget: 'executive_pay' | 'holdings' | 'ownership_changes' | 'all';
  format: 'json' | 'markdown';
}

export class XmitClient {
  private static instance: XmitClient;
  private readonly baseUrl: string;

  private constructor() {
    this.baseUrl = process.env['SML_API_BASE'] ?? 'https://api.scriptmasterlabs.com';
  }

  static getInstance(): XmitClient {
    if (!XmitClient.instance) {
      XmitClient.instance = new XmitClient();
    }
    return XmitClient.instance;
  }

  async decode(params: XmitDecodeParams): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/xmit/v1/decode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filing_url: params.filingUrl,
        parse_target: params.parseTarget,
        format: params.format,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      throw new Error(`xMIT API error: HTTP ${res.status}`);
    }

    return res.json();
  }
}
