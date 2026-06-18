const PRICE_CACHE_TTL = parseInt(process.env['PRICE_CACHE_TTL_MS'] ?? '60000', 10);

const BASE_PRICES: Record<string, string> = {
  leviathan_signal: '0.05',
  xmit_edgar_decode: '0.02',
  xdeo_earnings_estimate: '0.02',
  ftd_threshold_scan: '0.05',
  nexus_agent_hire: '0.00', // commission-based
  crawl_paid_fetch: '0.005',
};

interface CachedPrice {
  price: string;
  fetchedAt: number;
}

export class PriceRegistry {
  private static instance: PriceRegistry;
  private readonly cache = new Map<string, CachedPrice>();
  private readonly baseUrl: string;

  private constructor() {
    this.baseUrl = process.env['SML_API_BASE'] ?? 'https://api.scriptmasterlabs.com';
  }

  static getInstance(): PriceRegistry {
    if (!PriceRegistry.instance) {
      PriceRegistry.instance = new PriceRegistry();
    }
    return PriceRegistry.instance;
  }

  async getPrice(toolName: string): Promise<string | null> {
    const cached = this.cache.get(toolName);
    const now = Date.now();

    if (cached && now - cached.fetchedAt < PRICE_CACHE_TTL) {
      return cached.price;
    }

    // Fetch live price from SML pricing API
    try {
      const res = await fetch(`${this.baseUrl}/pricing/v1/tool/${toolName}`, {
        signal: AbortSignal.timeout(3000),
      });

      if (res.ok) {
        const body = (await res.json()) as { price: string };
        this.cache.set(toolName, { price: body.price, fetchedAt: now });
        return body.price;
      }
    } catch {
      // Fall through to hardcoded baseline
    }

    // Use hardcoded baseline if API unavailable
    const fallback = BASE_PRICES[toolName];
    if (fallback !== undefined) {
      // Cache fallback for 30s (half normal TTL) to retry sooner
      this.cache.set(toolName, { price: fallback, fetchedAt: now - PRICE_CACHE_TTL / 2 });
      return fallback;
    }

    // Price unknown and cache stale (N12) — reject
    return null;
  }

  seedDefaults(): void {
    const now = Date.now();
    for (const [tool, price] of Object.entries(BASE_PRICES)) {
      if (!this.cache.has(tool)) {
        this.cache.set(tool, { price, fetchedAt: now });
      }
    }
  }
}
