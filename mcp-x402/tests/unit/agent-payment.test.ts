import { describe, it, expect, afterEach } from 'vitest';
import {
  isAgentPaymentEnforced,
  resolveEndpointId,
  isVerified,
  enforceAgentPayment,
} from '../../src/server/payments/agent-payment.js';

describe('agent-payment — enforcement flag', () => {
  afterEach(() => {
    delete process.env['ENFORCE_AGENT_PAYMENT'];
  });

  it('is OFF unless explicitly true (safe default)', () => {
    delete process.env['ENFORCE_AGENT_PAYMENT'];
    expect(isAgentPaymentEnforced()).toBe(false);
    process.env['ENFORCE_AGENT_PAYMENT'] = 'false';
    expect(isAgentPaymentEnforced()).toBe(false);
    process.env['ENFORCE_AGENT_PAYMENT'] = 'TRUE';
    expect(isAgentPaymentEnforced()).toBe(true);
  });
});

describe('agent-payment — endpoint resolution', () => {
  afterEach(() => {
    delete process.env['PROOF402_ENDPOINT_SQUEEZEOS_COUNCIL'];
  });

  it('reads the per-tool endpoint UUID from env', () => {
    expect(resolveEndpointId('squeezeos_council')).toBeUndefined();
    process.env['PROOF402_ENDPOINT_SQUEEZEOS_COUNCIL'] = 'abc-123';
    expect(resolveEndpointId('squeezeos_council')).toBe('abc-123');
  });
});

describe('agent-payment — verify interpretation (defensive)', () => {
  it('accepts explicit success shapes', () => {
    expect(isVerified({ verified: true })).toBe(true);
    expect(isVerified({ valid: true })).toBe(true);
    expect(isVerified({ ok: true })).toBe(true);
    expect(isVerified({ status: 'confirmed' })).toBe(true);
    expect(isVerified({ status: 'PAID' })).toBe(true);
  });

  it('rejects errors and non-success shapes', () => {
    expect(isVerified({ error: 'nope' })).toBe(false);
    expect(isVerified({ verified: false })).toBe(false);
    expect(isVerified({ status: 'pending' })).toBe(false);
    expect(isVerified(null)).toBe(false);
    expect(isVerified('ok')).toBe(false);
    expect(isVerified({})).toBe(false);
  });
});

describe('agent-payment — gate fails closed when unconfigured', () => {
  afterEach(() => {
    delete process.env['PROOF402_ENDPOINT_SQUEEZEOS_COUNCIL'];
  });

  it('returns unconfigured (never paid) with no endpoint', async () => {
    delete process.env['PROOF402_ENDPOINT_SQUEEZEOS_COUNCIL'];
    const r = await enforceAgentPayment({ toolName: 'squeezeos_council', price: '0.10' });
    expect(r.status).toBe('unconfigured');
  });
});
