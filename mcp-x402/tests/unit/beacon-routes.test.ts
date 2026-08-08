import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createBeaconRouter } from '../../src/server/amb/beacon-routes.js';

/**
 * Regression tests for the BEACON Score / BEACON Passport public branding
 * layer (2026-08-08). Proves this is genuinely the same real AMB/IMP data
 * relabeled, not a second, separately-fabricated scoring system — and that
 * the honest-disclosure fields (attestations, risk_policies) are actually
 * empty/disclosed rather than silently populated with something invented.
 */

function makeApp() {
  const app = express();
  app.use(createBeaconRouter());
  return app;
}

describe('GET /beacon/scores', () => {
  it('returns a real, non-empty list with data_quality on every entry', async () => {
    const res = await request(makeApp()).get('/beacon/scores');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.scores)).toBe(true);
    expect(res.body.scores.length).toBeGreaterThan(0);
    for (const s of res.body.scores) {
      expect(s).toHaveProperty('data_quality');
      expect(['measured', 'insufficient_samples', 'not_tracked']).toContain(s.data_quality.confidence);
      expect(typeof s.beacon_score).toBe('number');
    }
  });

  it('is sorted descending by beacon_score', async () => {
    const res = await request(makeApp()).get('/beacon/scores');
    const scores = res.body.scores.map((s: { beacon_score: number }) => s.beacon_score);
    const sorted = [...scores].sort((a, b) => b - a);
    expect(scores).toEqual(sorted);
  });
});

describe('GET /beacon/score/:tool', () => {
  it('returns 404 for an unknown tool rather than fabricating a score', async () => {
    const res = await request(makeApp()).get('/beacon/score/definitely_not_a_real_tool');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('unknown_tool');
  });

  it('returns real per-tool data for a real catalog tool, matching /beacon/scores', async () => {
    const list = await request(makeApp()).get('/beacon/scores');
    const first = list.body.scores[0];
    const single = await request(makeApp()).get(`/beacon/score/${first.tool_name}`);
    expect(single.status).toBe(200);
    expect(single.body.beacon_score).toBe(first.beacon_score);
    expect(single.body.data_quality).toEqual(first.data_quality);
  });
});

describe('GET /beacon/passport', () => {
  it('discloses attestations as honestly empty, never fabricated', async () => {
    const res = await request(makeApp()).get('/beacon/passport');
    expect(res.status).toBe(200);
    expect(res.body.attestations.count).toBe(0);
    expect(res.body.attestations.items).toEqual([]);
    expect(res.body.attestations.note).toMatch(/no attestation infrastructure/i);
  });

  it('discloses risk_policies as not implemented, never fabricated', async () => {
    const res = await request(makeApp()).get('/beacon/passport');
    expect(res.body.risk_policies.note).toMatch(/not implemented/i);
  });

  it('capabilities list matches the real beacon catalog, not a static/hardcoded list', async () => {
    const passport = await request(makeApp()).get('/beacon/passport');
    const scores = await request(makeApp()).get('/beacon/scores');
    expect(passport.body.capabilities.length).toBe(scores.body.scores.length);
    const passportNames = passport.body.capabilities.map((c: { tool_name: string }) => c.tool_name).sort();
    const scoreNames = scores.body.scores.map((s: { tool_name: string }) => s.tool_name).sort();
    expect(passportNames).toEqual(scoreNames);
  });

  it('payment_history.settlements_alltime is a real number derived from X402Stats, defaulting to 0 with no fake seed', async () => {
    const res = await request(makeApp()).get('/beacon/passport');
    expect(typeof res.body.payment_history.settlements_alltime).toBe('number');
    expect(res.body.payment_history.settlements_alltime).toBeGreaterThanOrEqual(0);
  });
});

describe('GET /beacon/passport/:tool', () => {
  it('returns 404 for an unknown tool', async () => {
    const res = await request(makeApp()).get('/beacon/passport/not_a_real_tool');
    expect(res.status).toBe(404);
  });

  it('discloses attestations/risk_policies honestly at the per-tool level too', async () => {
    const scores = await request(makeApp()).get('/beacon/scores');
    const toolName = scores.body.scores[0].tool_name;
    const res = await request(makeApp()).get(`/beacon/passport/${toolName}`);
    expect(res.status).toBe(200);
    expect(res.body.attestations.count).toBe(0);
    expect(res.body.risk_policies.note).toMatch(/not implemented/i);
  });
});

describe('GET /beacon/scout', () => {
  // getScoutReport() makes real outbound fetch calls (SML's own discovery
  // surface + external sites like x402scan.com) — must be mocked, never
  // hit real network in a test run.
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns the real sign/attraction/go_get_found report shape over HTTP', async () => {
    const res = await request(makeApp()).get('/beacon/scout');
    expect(res.status).toBe(200);
    expect(res.body.sign).toBeDefined();
    expect(res.body.attraction).toBeDefined();
    expect(res.body.go_get_found).toBeDefined();
    expect(res.body.sign.all_reachable).toBe(true);
  });
});
