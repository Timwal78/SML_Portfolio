import { describe, it, expect } from 'vitest';
import { PriceRegistry } from '../../src/server/registry/pricing.js';

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
});
