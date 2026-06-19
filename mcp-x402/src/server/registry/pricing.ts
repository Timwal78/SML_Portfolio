const PRICE_CACHE_TTL = parseInt(process.env['PRICE_CACHE_TTL_MS'] ?? '60000', 10);

const BASE_PRICES: Record<string, string> = {
  // Discovery (free)
  sml_discover: '0.00',
  sml_status: '0.00',
  // SqueezeOS signals
  leviathan_signal: '0.05',
  squeezeos_council: '0.10',
  squeezeos_scan: '0.05',
  squeezeos_options: '0.05',
  squeezeos_iwm: '0.03',
  squeezeos_preview: '0.00',
  squeezeos_status: '0.00',
  // SEC / Earnings
  xmit_edgar_decode: '0.02',
  xdeo_earnings_estimate: '0.02',
  // FTD
  ftd_threshold_scan: '0.05',
  // Crawl
  crawl_paid_fetch: '0.005',
  // Agent marketplace
  nexus_agent_hire: '0.00',
  nexus_agent_list: '0.00',
  nexus_agent_status: '0.00',
  // Ghost Layer (cross-chain)
  ghost_transfer: '0.02',
  ghost_status: '0.00',
  ghost_routes: '0.00',
  // RLUSD Rails
  rails_send: '0.01',
  rails_status: '0.00',
  // Launchpad
  launchpad_create_token: '0.10',
  launchpad_buy_token: '0.02',
  launchpad_list: '0.00',
  launchpad_status: '0.00',
  // Copy-Trader
  copytrader_subscribe: '0.05',
  copytrader_status: '0.00',
  // Backtest
  backtest_run: '0.05',
  backtest_validate: '0.05',
  backtest_status: '0.00',
  // Brokers (Tradier)
  brokers_quote: '0.00',
  brokers_options_chain: '0.01',
  brokers_place_order: '0.05',
  brokers_account: '0.01',
  // Shadow Desk
  shadow_query: '0.05',
  shadow_ingest: '0.02',
  shadow_status: '0.00',
  // Forge (LLM gateway)
  forge_complete: '0.02',
  forge_status: '0.00',
  // Proof402
  proof402_get_invoice: '0.00',
  proof402_verify: '0.00',
  proof402_credit_score: '0.00',
  // Echo (pattern matching)
  echo_analogs: '0.05',
  // Agent card / identity
  agentcard_verify: '0.00',
  agentcard_register: '0.01',
  agentcard_lookup: '0.00',
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
    this.baseUrl = process.env['SML_API_BASE'] ?? 'https://squeezeos-api.onrender.com';
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
      this.cache.set(toolName, { price: fallback, fetchedAt: now - PRICE_CACHE_TTL / 2 });
      return fallback;
    }

    // Unknown tool — default to free rather than reject
    this.cache.set(toolName, { price: '0.00', fetchedAt: now });
    return '0.00';
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
