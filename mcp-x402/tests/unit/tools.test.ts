import { describe, it, expect } from 'vitest';
import { CATALOG, getToolMeta } from '../../src/server/registry/catalog.js';

describe('Tool Catalog', () => {
  it('has exactly 6 tools', () => {
    expect(CATALOG).toHaveLength(6);
  });

  it('all tools have name, description, price, currency', () => {
    for (const tool of CATALOG) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.price).toBeTruthy();
      expect(['USDC', 'RLUSD']).toContain(tool.currency);
    }
  });

  it('leviathan is 0.05 USDC', () => {
    const t = getToolMeta('leviathan_signal');
    expect(t?.price).toBe('0.05');
    expect(t?.currency).toBe('USDC');
  });

  it('ftd has 15-min cache', () => {
    const t = getToolMeta('ftd_threshold_scan');
    expect(t?.cacheTtl).toBe(900);
  });

  it('nexus has free tier for queries', () => {
    const t = getToolMeta('nexus_agent_hire');
    expect(t?.freeTier).toBe('query_only');
  });

  it('crawl is 0.005 USDC', () => {
    const t = getToolMeta('crawl_paid_fetch');
    expect(t?.price).toBe('0.005');
  });

  it('getToolMeta returns undefined for unknown tool', () => {
    expect(getToolMeta('unknown_tool')).toBeUndefined();
  });
});
