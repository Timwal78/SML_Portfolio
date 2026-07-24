const PRICE_CACHE_TTL = parseInt(process.env['PRICE_CACHE_TTL_MS'] ?? '60000', 10);

// Keys MUST match the toolName each tool passes to getPrice()/executeX402Payment().
// Paid-tool prices MUST equal what sml_discover advertises (advertised == charged).
// A drift-guard test (tests/unit/pricing-drift.test.ts) enforces both.
const BASE_PRICES: Record<string, string> = {
  // Discovery (free)
  sml_discover: '0.00',
  sml_status: '0.00',
  // APM — Agent Preference Manifest (free preview, paid contract)
  apm_negotiate: '0.02',
  // SqueezeOS signals
  leviathan_signal: '0.05',
  squeezeos_council: '0.10',
  squeezeos_scan: '0.05',
  squeezeos_options: '0.05',
  squeezeos_iwm: '0.03',
  squeezeos_preview: '0.00',
  squeezeos_status: '0.00',
  // Equities / Options heatmap (self-contained: Polygon.io + Claude swarm)
  equities_heatmap_preview: '0.00',
  equities_heatmap_full: '0.10',
  options_delta_heatmap_preview: '0.00',
  options_delta_heatmap_full: '0.15',
  // SEC / Earnings
  xmit_edgar_decode: '0.02',
  xdeo_earnings_estimate: '0.02',
  // FTD
  ftd_threshold_scan: '0.05',
  // Crawl
  crawl_paid_fetch: '0.005',
  // Agent marketplace
  nexus_agent_hire: '0.00',
  // Ghost Layer (cross-chain)
  ghost_route: '0.01',
  ghost_status: '0.00',
  // RLUSD Rails
  rails_transfer: '0.01',
  rails_status: '0.00',
  // Launchpad
  launchpad_create: '0.10',
  launchpad_buy: '0.01',
  launchpad_list: '0.00',
  launchpad_status: '0.00',
  // Copy-Trader
  copytrader_subscribe: '0.05',
  copytrader_status: '0.00',
  // Backtest
  backtest_run: '0.05',
  backtest_validate: '0.05',
  backtest_status: '0.00',
  // Brokers (Tradier + Robinhood order execution)
  tradier_order: '0.01',
  robinhood_order: '0.01',
  // Shadow Desk
  shadow_query: '0.02',
  shadow_ingest: '0.01',
  shadow_status: '0.00',
  // Forge (LLM gateway)
  forge_llm: '0.02',
  forge_status: '0.00',
  // Proof402 (free)
  proof_invoice: '0.00',
  proof_verify: '0.00',
  proof_credit_score: '0.00',
  // Echo (pattern matching)
  echo_pattern_match: '0.05',
  // Agent card / identity
  agentcard_mint: '0.01',
  agentcard_verify: '0.00',
  agentcard_lookup: '0.00',
  // Federal data (Grants.gov + SAM.gov)
  search_grants: '0.02',
  search_contracts: '0.03',
  lookup_entity: '0.02',
  federal_sam_opportunities: '0.10',
  federal_sam_entity: '0.10',
  // federal.ts paid tools (baseline if pricing API down)
  federal_grants: '0.15',
  federal_usaspending_awards: '0.15',
  federal_grants_gov: '0.15',
  federal_sba_awards: '0.15',
  // Export compliance (Trade.gov Consolidated Screening List)
  screen_restricted_party: '0.03',
  // Export opportunities (Trade.gov Trade Leads)
  search_trade_leads: '0.03',
  // Crypto market data (CoinGecko)
  crypto_token_price: '0.01',
  crypto_trending: '0.01',
  // FX rates (Frankfurter / ECB)
  fx_exchange_rate: '0.01',
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

    // Unknown tool — reject rather than silently treat as free.
    // Returning '0.00' here would let any unknown/mistyped tool name be served
    // for free (revenue + safety leak). Callers that charge must get null and stop.
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
