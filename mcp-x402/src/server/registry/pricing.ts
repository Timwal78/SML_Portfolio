const PRICE_CACHE_TTL = parseInt(process.env['PRICE_CACHE_TTL_MS'] ?? '60000', 10);

// Keys MUST match the toolName each tool passes to getPrice()/executeX402Payment().
// Paid-tool prices MUST equal what sml_discover advertises (advertised == charged).
// A drift-guard test (tests/unit/pricing-drift.test.ts) enforces both.
const BASE_PRICES: Record<string, string> = {
  // Discovery (free)
  sml_discover: '0.00',
  sml_status: '0.00',
  // APM — Agent Preference Manifest (free preview, paid contract)
  apm_negotiate: '0.001',
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
  equities_heatmap_full: '0.001',
  options_delta_heatmap_preview: '0.00',
  options_delta_heatmap_full: '0.001',
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
  ghost_route: '0.001',
  ghost_status: '0.00',
  // RLUSD Rails
  rails_transfer: '0.001',
  rails_status: '0.00',
  // Launchpad
  launchpad_create: '0.001',
  launchpad_buy: '0.001',
  launchpad_list: '0.00',
  launchpad_status: '0.00',
  // Copy-Trader
  copytrader_subscribe: '0.001',
  copytrader_status: '0.00',
  // Backtest
  backtest_run: '0.001',
  backtest_validate: '0.001',
  backtest_status: '0.00',
  // Brokers (Tradier + Robinhood order execution)
  tradier_order: '0.001',
  robinhood_order: '0.001',
  // Shadow Desk
  shadow_query: '0.001',
  shadow_ingest: '0.001',
  shadow_status: '0.00',
  // Forge (LLM gateway)
  forge_llm: '0.001',
  forge_status: '0.00',
  // Proof402 (free)
  proof_invoice: '0.00',
  proof_verify: '0.00',
  proof_credit_score: '0.00',
  // Echo (pattern matching)
  echo_pattern_match: '0.001',
  // Agent card / identity
  agentcard_mint: '0.001',
  agentcard_verify: '0.00',
  agentcard_lookup: '0.00',
  // Federal data (Grants.gov + SAM.gov)
  search_grants: '0.001',
  search_contracts: '0.001',
  lookup_entity: '0.001',
  federal_sam_opportunities: '0.001',
  federal_sam_entity: '0.001',
  // federal.ts paid tools (baseline if pricing API down)
  federal_grants: '0.001',
  federal_usaspending_awards: '0.001',
  federal_grants_gov: '0.001',
  federal_sba_awards: '0.001',
  // Export compliance (Trade.gov Consolidated Screening List)
  screen_restricted_party: '0.001',
  // Export opportunities (Trade.gov Trade Leads)
  search_trade_leads: '0.001',
  // Crypto market data (CoinGecko)
  crypto_token_price: '0.001',
  crypto_trending: '0.001',
  // FX rates (Frankfurter / ECB)
  fx_exchange_rate: '0.001',
  // Housing / Section 8 / PHA
  pha_lookup: '0.001',
  hcv_fmr: '0.001',
  housing_landlord_checklist: '0.001',
  hud_vash_contacts: '0.001',
  // Housing / Section 8 — nationwide, live HUD User API (not the curated Kinston seed above).
  // Differentiated pricing per the Section 8/HUD listing's public agent (x402) rate card —
  // deliberately NOT the flat $0.001 used elsewhere in this file.
  section8_geo_lookup: '0.004',
  section8_fmr: '0.006',
  section8_income_limits: '0.006',
  pha_opportunities: '0.012',
  // Live as of the HUD Open Data ArcGIS FeatureServer being independently
  // verified — see docs/SECTION8_HUD_LISTING.md.
  pha_search: '0.008',
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
