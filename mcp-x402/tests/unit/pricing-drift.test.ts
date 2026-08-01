import { describe, it, expect } from 'vitest';
import { PriceRegistry } from '../../src/server/registry/pricing.js';
import { CATALOG } from '../../src/server/registry/catalog.js';
import { CAPABILITIES } from '../../src/server/apm/capabilities.js';

/**
 * Drift guard. Every PAID tool calls PriceRegistry.getPrice(<toolName>) and then
 * executeX402Payment, which REJECTS when the price is null. If a tool name and its
 * BASE_PRICES key ever drift apart (e.g. ghost_route vs ghost_transfer), getPrice
 * returns null and the tool breaks — or, pre-fix, was silently served for free.
 *
 * This list is the authoritative set of paid tool names (the literal keys passed to
 * getPrice() across src/server/tools). Keep it in sync when adding a paid tool.
 */
const PAID_TOOLS = [
  'apm_negotiate',
  'leviathan_signal',
  'squeezeos_council',
  'squeezeos_scan',
  'squeezeos_options',
  'squeezeos_iwm',
  'equities_heatmap_full',
  'options_delta_heatmap_full',
  'xmit_edgar_decode',
  'xdeo_earnings_estimate',
  'ftd_threshold_scan',
  'crawl_paid_fetch',
  'ghost_route',
  'rails_transfer',
  'launchpad_create',
  'launchpad_buy',
  'copytrader_subscribe',
  'backtest_validate',
  'tradier_order',
  'robinhood_order',
  'shadow_query',
  'shadow_ingest',
  'forge_llm',
  'echo_pattern_match',
  'agentcard_mint',
  'search_grants',
  'search_contracts',
  'lookup_entity',
  'pha_lookup',
  'hcv_fmr',
  'housing_landlord_checklist',
  'hud_vash_contacts',
  'section8_geo_lookup',
  'section8_fmr',
  'section8_income_limits',
  'pha_opportunities',
  'pha_search',
] as const;

describe('pricing drift guard', () => {
  it('every paid tool resolves to a non-null, positive price (no name drift)', async () => {
    const registry = PriceRegistry.getInstance();
    registry.seedDefaults(); // populate cache so getPrice resolves offline

    const broken: string[] = [];
    for (const tool of PAID_TOOLS) {
      const price = await registry.getPrice(tool);
      if (price === null || Number(price) <= 0 || Number.isNaN(Number(price))) {
        broken.push(`${tool} -> ${price}`);
      }
    }

    expect(broken, `Paid tools with missing/invalid price (BASE_PRICES drift): ${broken.join(', ')}`).toEqual([]);
  });

  it('unknown tools still reject with null', async () => {
    const registry = PriceRegistry.getInstance();
    registry.seedDefaults();
    expect(await registry.getPrice('definitely_not_a_tool')).toBeNull();
  });

  /**
   * Real regression found 2026-08-01: every entry in CATALOG (what
   * sml_discover advertises to agents) had drifted from BASE_PRICES (what
   * executeX402Payment actually charges) — all six flattened to a 0.001
   * placeholder while CATALOG still advertised leviathan_signal=0.05,
   * xmit_edgar_decode=0.02, xdeo_earnings_estimate=0.02,
   * ftd_threshold_scan=0.05, crawl_paid_fetch=0.005. The BASE_PRICES doc
   * comment itself says "advertised == charged" is required — this test
   * makes that a real, enforced guarantee for every catalog-listed tool
   * instead of just an aspirational comment.
   */
  it('every CATALOG price matches the real BASE_PRICES charge (advertised == charged)', async () => {
    const registry = PriceRegistry.getInstance();
    registry.seedDefaults();

    const drifted: string[] = [];
    for (const tool of CATALOG) {
      if (Number(tool.price) <= 0) continue; // free tools (e.g. nexus_agent_hire query tier)
      const charged = await registry.getPrice(tool.name);
      if (charged !== tool.price) {
        drifted.push(`${tool.name}: advertised ${tool.price}, charged ${charged}`);
      }
    }

    expect(drifted, `CATALOG/BASE_PRICES drift: ${drifted.join('; ')}`).toEqual([]);
  });

  /**
   * Same drift class, second real instance found the same day: the APM
   * capability list's basePrice (used for agent budget-fit matching) had
   * also flattened all four SqueezeOS-proxied paid tools to 0.001, while
   * apm.test.ts's own assertions (and SqueezeOS's real published pricing —
   * council 0.10 / scan 0.05 / options 0.05 / iwm 0.03 RLUSD) expect the
   * real values. An agent budgeting against the advertised APM price would
   * have under-budgeted, then failed payment at the real charge.
   */
  it('every paid squeezeos_* APM capability basePrice matches its real BASE_PRICES charge', async () => {
    const registry = PriceRegistry.getInstance();
    registry.seedDefaults();

    const drifted: string[] = [];
    for (const cap of CAPABILITIES) {
      if (!cap.paid || !cap.tool.startsWith('squeezeos_')) continue;
      const charged = await registry.getPrice(cap.tool);
      if (charged !== cap.basePrice) {
        drifted.push(`${cap.tool}: APM basePrice ${cap.basePrice}, charged ${charged}`);
      }
    }

    expect(drifted, `APM capabilities/BASE_PRICES drift: ${drifted.join('; ')}`).toEqual([]);
  });
});
