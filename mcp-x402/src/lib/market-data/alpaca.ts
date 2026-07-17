// Alpaca Market Data client — real, free-tier "most active" discovery.
// Used specifically as a free alternative to Polygon's gainers/losers snapshot
// (which requires a paid Polygon plan): Alpaca's movers/screener endpoint is
// included on their free market-data tier. Never returns mock data: a missing
// key or an upstream error throws.

const ALPACA_DATA_BASE = 'https://data.alpaca.markets';

interface AlpacaMover {
  symbol?: string;
}

/**
 * Real, live "most active" discovery via Alpaca's free screener endpoint —
 * top gainers + losers by day percent change, merged and deduped.
 */
export async function fetchTrendingTickers(apiKeyId: string, apiSecret: string, limitEach = 15): Promise<string[]> {
  if (!apiKeyId || !apiSecret) throw new Error('Alpaca API key/secret is required — set ALPACA_API_KEY and ALPACA_API_SECRET');

  const url = `${ALPACA_DATA_BASE}/v1beta1/screener/stocks/movers?top=${limitEach}`;
  const res = await fetch(url, {
    headers: { 'APCA-API-KEY-ID': apiKeyId, 'APCA-API-SECRET-KEY': apiSecret, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '(unreadable body)');
    throw new Error(`Alpaca movers screener → HTTP ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { gainers?: AlpacaMover[]; losers?: AlpacaMover[] };
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const m of [...(data.gainers ?? []), ...(data.losers ?? [])]) {
    const symbol = m.symbol ?? '';
    if (/^[A-Z]{1,5}$/.test(symbol) && !seen.has(symbol)) { seen.add(symbol); merged.push(symbol); }
  }
  return merged;
}
