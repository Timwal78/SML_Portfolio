import { describe, it, expect, afterEach } from 'vitest';
import { getPaymentReceiver } from '../../src/server/payments/x402.js';

/**
 * Revenue guard. If the payment receiver is empty, executeX402Payment falls into
 * "log only" mode and collects nothing. This was the live state (SML_PAYMENT_RECEIVER
 * unset on Render). The gateway must always resolve a valid collection address.
 */
describe('payment receiver', () => {
  afterEach(() => {
    delete process.env['SML_PAYMENT_RECEIVER'];
  });

  it('defaults to a valid Base address when env is unset (never collects $0 by accident)', () => {
    delete process.env['SML_PAYMENT_RECEIVER'];
    const receiver = getPaymentReceiver();
    expect(receiver).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(receiver).toBe('0x4e14B249D9A4c9c9352D780eCEB508A8eB7a7700');
  });

  it('honors an explicit env override', () => {
    process.env['SML_PAYMENT_RECEIVER'] = '0x1111111111111111111111111111111111111111';
    expect(getPaymentReceiver()).toBe('0x1111111111111111111111111111111111111111');
  });
});
