import { describe, it, expect, beforeEach, vi } from 'vitest';

// EXPECTED_PRODUCT_CODE for the existing full-catalog listing (prod-lop2m2yjjcs76),
// same literal already hardcoded in src/server/aws/marketplace.ts.
const FULL_CATALOG_PRODUCT_CODE = 'c6g8c5zsvgof5a4rpp6eqlzn';
const HOUSING_PRODUCT_CODE = 'test-housing-product-code';

describe('productCoversResource', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('the full-catalog product code covers any resource path', async () => {
    delete process.env['AWS_MARKETPLACE_HOUSING_PRODUCT_CODE'];
    const { productCoversResource } = await import('../../src/server/aws/marketplace.js');
    expect(productCoversResource(FULL_CATALOG_PRODUCT_CODE, '/x402/pha-lookup')).toBe(true);
    expect(productCoversResource(FULL_CATALOG_PRODUCT_CODE, '/x402/grants')).toBe(true);
    expect(productCoversResource(FULL_CATALOG_PRODUCT_CODE, '/anything-not-yet-invented')).toBe(true);
  });

  it('an unconfigured/unknown product code covers nothing (fails closed, never open)', async () => {
    delete process.env['AWS_MARKETPLACE_HOUSING_PRODUCT_CODE'];
    const { productCoversResource } = await import('../../src/server/aws/marketplace.js');
    expect(productCoversResource('some-code-nobody-configured', '/x402/pha-lookup')).toBe(false);
  });

  it('when AWS_MARKETPLACE_HOUSING_PRODUCT_CODE is set, that product only covers its own housing resource paths', async () => {
    process.env['AWS_MARKETPLACE_HOUSING_PRODUCT_CODE'] = HOUSING_PRODUCT_CODE;
    const { productCoversResource } = await import('../../src/server/aws/marketplace.js');

    // Covered
    for (const path of [
      '/x402/pha-lookup',
      '/x402/hcv-fmr',
      '/x402/hud-vash-contacts',
      '/x402/housing-landlord-checklist',
      '/x402/housing-windsor',
      '/x402/section8-geo-lookup',
      '/x402/section8-fmr',
      '/x402/section8-income-limits',
      '/x402/pha-opportunities',
      '/x402/pha-search',
    ]) {
      expect(productCoversResource(HOUSING_PRODUCT_CODE, path)).toBe(true);
    }

    // A housing-entitled customer must NOT get free access to the rest of the catalog.
    expect(productCoversResource(HOUSING_PRODUCT_CODE, '/x402/grants')).toBe(false);
    expect(productCoversResource(HOUSING_PRODUCT_CODE, '/x402/pha-lookup-typo')).toBe(false);

    // The full-catalog product code still covers everything regardless.
    expect(productCoversResource(FULL_CATALOG_PRODUCT_CODE, '/x402/grants')).toBe(true);

    delete process.env['AWS_MARKETPLACE_HOUSING_PRODUCT_CODE'];
  });
});
