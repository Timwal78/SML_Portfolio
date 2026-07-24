import { describe, it, expect } from 'vitest';
import { resolveOffering } from '../../src/server/acp/seller.js';

describe('resolveOffering', () => {
  it('matches the canonical Title Case key exactly', () => {
    const resolved = resolveOffering('SqueezeOS Triple Lock Signal');
    expect(resolved?.key).toBe('SqueezeOS Triple Lock Signal');
  });

  it('matches a snake_case job description via normalization', () => {
    const resolved = resolveOffering('squeezeos_triple_lock_signal');
    expect(resolved?.key).toBe('SqueezeOS Triple Lock Signal');
  });

  it('matches a lowercase/spaced job description via normalization', () => {
    const resolved = resolveOffering('squeezeos triple lock signal');
    expect(resolved?.key).toBe('SqueezeOS Triple Lock Signal');
  });

  it('still matches marketing-copy prefixes of the exact key', () => {
    const resolved = resolveOffering('SqueezeOS Triple Lock Signal — real-time consensus alerts');
    expect(resolved?.key).toBe('SqueezeOS Triple Lock Signal');
  });

  it('returns undefined for a genuinely unknown offering', () => {
    expect(resolveOffering('some_other_product_nobody_sells')).toBeUndefined();
  });
});
