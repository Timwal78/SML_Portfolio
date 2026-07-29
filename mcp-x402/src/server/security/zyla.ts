/**
 * ZylaLabs marketplace rail — NON-CRYPTO ONLY.
 *
 * Zyla reviewers cannot settle x402/USDC. Without a key rail they only ever
 * see HTTP 402 (or whatever free snack accidentally worked — historically
 * gas-tracker, which is crypto and against Zyla policy).
 *
 * This module:
 *  1) Accepts Bearer sml_zyla_*  OR  X-Zyla-Key: sml_zyla_*
 *  2) Allows ONLY an explicit non-crypto path allowlist
 *  3) HARD-BLOCKS crypto product paths even if key is valid
 *  4) Enforces RPM (Basic ≥60, Ultimate ≤240 default 120)
 *
 * Does NOT free the public internet. Unauthenticated callers still get 402.
 */

import type { Request, Response } from 'express';

/** Paths Zyla must NEVER reach — crypto / chain / gas / token product surface. */
export const ZYLA_CRYPTO_BLOCKLIST: readonly string[] = [
  '/x402/gas-tracker',
  '/x402/crypto-price',
  '/x402/crypto-trending',
  '/x402/eth-rpc',
  '/x402/base-rpc',
] as const;

/**
 * Explicit allowlist — federal / SEC / FDA / housing / compliance / macro.
 * Only these paths may skip x402 when a valid Zyla key is present.
 * Keep this list product-safe for Tomas: no gas, no tokens, no wallets.
 */
export const ZYLA_ALLOWLIST: readonly string[] = [
  '/x402/agent-score',
  '/x402/bounties',
  '/x402/cascade-signal',
  '/x402/chat/completions',
  '/x402/clinical-trials',
  '/x402/cms-providers',
  '/x402/compliance-anomaly',
  '/x402/compliance-audit',
  '/x402/compliance-regulator-query',
  '/x402/congress-bills',
  '/x402/content-trust-score',
  '/x402/domain-enrich',
  '/x402/drug-adverse-events',
  '/x402/drug-label',
  '/x402/drug-recall',
  '/x402/echonet',
  '/x402/entity-compliance',
  '/x402/epa-violations',
  '/x402/equities-heatmap',
  '/x402/fact-check',
  '/x402/fda-510k',
  '/x402/fda-warnings',
  '/x402/fec-finance',
  '/x402/finra-broker',
  '/x402/firms',
  '/x402/fred',
  '/x402/ftd-etf-basket',
  '/x402/ftd-ratio',
  '/x402/ftd-settlement-cycle',
  '/x402/ftd-threshold-list',
  '/x402/ftd-time-series',
  '/x402/fx-rate',
  '/x402/grants',
  '/x402/graph',
  '/x402/graph/agent',
  '/x402/hcv-fmr',
  '/x402/housing-landlord-checklist',
  '/x402/housing-windsor',
  '/x402/hud-vash-contacts',
  '/x402/hunters',
  '/x402/hunters/report',
  '/x402/iam-model',
  '/x402/insider-trades',
  '/x402/llm-chat',
  '/x402/lobbying',
  '/x402/market',
  '/x402/max-conviction-signal',
  '/x402/news-headlines',
  '/x402/nih-grants',
  '/x402/npi',
  '/x402/options-delta-heatmap',
  '/x402/options-flow',
  '/x402/osha',
  '/x402/patents',
  '/x402/pha-lookup',
  '/x402/restricted-party-screen',
  '/x402/sbir-grants',
  '/x402/sec-10k',
  '/x402/sec-10q',
  '/x402/sec-13dg',
  '/x402/sec-13f',
  '/x402/sec-8k',
  '/x402/social-search',
  '/x402/trade-leads',
  '/x402/treasury-yields',
  '/x402/web-fetch',
  '/x402/web-markdown',
  '/x402/web-search',
] as const;

const ALLOW = new Set(ZYLA_ALLOWLIST.map((p) => p.toLowerCase()));
const BLOCK = new Set(ZYLA_CRYPTO_BLOCKLIST.map((p) => p.toLowerCase()));

/** Extra leaf patterns that must never pass even if someone expands allowlist carelessly. */
const CRYPTO_LEAF_RE =
  /\b(gas-tracker|crypto-|token|defi|nft|wallet|airdrop|rugpull|eth-rpc|base-rpc|solana|bitcoin|onchain|web3|dex|cex|perp)\b/i;

export type ZylaTier = 'basic' | 'ultimate' | 'review';

export interface ZylaAuthResult {
  ok: true;
  tier: ZylaTier;
  keyId: string;
  rpm: number;
}

export interface ZylaDeny {
  ok: false;
  status: number;
  error: string;
  detail?: string;
}

function parseKeys(envVal: string | undefined): Map<string, ZylaTier> {
  const map = new Map<string, ZylaTier>();
  const raw = (envVal ?? '').trim();
  if (!raw) return map;
  // Formats:
  //   sml_zyla_xxx
  //   sml_zyla_a,sml_zyla_b
  //   review:sml_zyla_a,basic:sml_zyla_b,ultimate:sml_zyla_c
  for (const part of raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)) {
    let tier: ZylaTier = 'review';
    let key = part;
    const m = part.match(/^(review|basic|ultimate):(.+)$/i);
    if (m) {
      tier = m[1].toLowerCase() as ZylaTier;
      key = m[2].trim();
    }
    if (!key.startsWith('sml_zyla_')) continue;
    map.set(key, tier);
  }
  return map;
}

function extractZylaKey(req: Request): string {
  const h = req.headers;
  const x = h['x-zyla-key'];
  if (typeof x === 'string' && x.trim()) return x.trim();
  const auth = h['authorization'] ?? h['Authorization'];
  if (typeof auth === 'string') {
    const m = auth.match(/^\s*Bearer\s+(.+)\s*$/i);
    if (m) return m[1].trim();
    // Some marketplaces send raw key in Authorization
    if (auth.trim().startsWith('sml_zyla_')) return auth.trim();
  }
  const q = req.query?.['api_key'] ?? req.query?.['apikey'];
  if (typeof q === 'string' && q.startsWith('sml_zyla_')) return q.trim();
  return '';
}

function tierRpm(tier: ZylaTier): number {
  const basic = Math.max(60, parseInt(process.env['ZYLA_RPM_BASIC'] ?? '60', 10) || 60);
  const ultimate = Math.min(240, Math.max(basic, parseInt(process.env['ZYLA_RPM_ULTIMATE'] ?? '120', 10) || 120));
  const review = Math.max(60, parseInt(process.env['ZYLA_RPM_REVIEW'] ?? '90', 10) || 90);
  if (tier === 'ultimate') return ultimate;
  if (tier === 'basic') return basic;
  return review;
}

// Simple in-memory RPM buckets (per key)
const rpmBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRpm(keyId: string, rpm: number): boolean {
  const now = Date.now();
  let b = rpmBuckets.get(keyId);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + 60_000 };
    rpmBuckets.set(keyId, b);
  }
  if (b.count >= rpm) return false;
  b.count += 1;
  return true;
}

export function normalizeZylaPath(path: string): string {
  // strip query, trailing slash
  const p = (path.split('?')[0] || '/').replace(/\/+$/, '') || '/';
  return p.startsWith('/') ? p : `/${p}`;
}

export function isZylaCryptoBlocked(path: string): boolean {
  const p = normalizeZylaPath(path).toLowerCase();
  if (BLOCK.has(p)) return true;
  if (CRYPTO_LEAF_RE.test(p)) return true;
  return false;
}

export function isZylaAllowlisted(path: string): boolean {
  const p = normalizeZylaPath(path).toLowerCase();
  return ALLOW.has(p);
}

/**
 * Attempt Zyla marketplace auth for this request+resource.
 * Returns:
 *  - null if no Zyla key presented (caller continues normal x402 flow)
 *  - ZylaAuthResult if key valid + path allowed
 *  - writes 403/429 response and returns deny if key present but rejected
 */
export function tryZylaBypass(
  req: Request,
  res: Response,
  resourcePath: string,
): ZylaAuthResult | ZylaDeny | null {
  const key = extractZylaKey(req);
  if (!key) return null;

  const keys = parseKeys(process.env['ZYLA_API_KEYS'] ?? process.env['ZYLA_API_KEY']);
  if (keys.size === 0) {
    // Key presented but server not configured — fail closed for that key, don't 500
    res.status(503).set('Access-Control-Allow-Origin', '*').json({
      error: 'zyla_rail_unconfigured',
      detail: 'Zyla API key rail is not configured on this deployment.',
    });
    return { ok: false, status: 503, error: 'zyla_rail_unconfigured' };
  }

  const tier = keys.get(key);
  if (!tier) {
    res.status(401).set('Access-Control-Allow-Origin', '*').json({
      error: 'invalid_zyla_key',
      detail: 'API key not recognized. Use the sml_zyla_* key from your Zyla subscription.',
    });
    return { ok: false, status: 401, error: 'invalid_zyla_key' };
  }

  const path = normalizeZylaPath(resourcePath || req.path || '');

  // HARD crypto block — never allow gas/token even with valid key
  if (isZylaCryptoBlocked(path)) {
    res.status(403).set('Access-Control-Allow-Origin', '*').json({
      error: 'zyla_crypto_blocked',
      detail:
        'This endpoint is cryptocurrency-related and is not available on the Zyla marketplace plan. Use a non-crypto federal/SEC/FDA/housing/compliance endpoint.',
      path,
    });
    return { ok: false, status: 403, error: 'zyla_crypto_blocked', detail: path };
  }

  if (!isZylaAllowlisted(path)) {
    res.status(403).set('Access-Control-Allow-Origin', '*').json({
      error: 'zyla_path_not_listed',
      detail:
        'Endpoint is not on the Zyla non-cryptocurrency catalog. See GET /x402/zyla/catalog for the approved list.',
      path,
    });
    return { ok: false, status: 403, error: 'zyla_path_not_listed', detail: path };
  }

  const rpm = tierRpm(tier);
  const keyId = `${tier}:${key.slice(0, 16)}`;
  if (!checkRpm(keyId, rpm)) {
    res.status(429).set('Access-Control-Allow-Origin', '*').set('Retry-After', '60').json({
      error: 'zyla_rate_limited',
      detail: `Rate limit exceeded for tier=${tier} (max ${rpm} rpm).`,
      rpm,
      tier,
    });
    return { ok: false, status: 429, error: 'zyla_rate_limited' };
  }

  return { ok: true, tier, keyId, rpm };
}

export function zylaCatalogPublic(baseUrl: string): Record<string, unknown> {
  return {
    vendor: 'Script Master Labs, LLC',
    marketplace: 'ZylaLabs',
    policy: {
      cryptocurrency: false,
      note: 'Zyla plan is non-cryptocurrency only. Gas/token/wallet/chain RPC endpoints are blocked on this rail.',
    },
    auth: {
      header_bearer: 'Authorization: Bearer sml_zyla_...',
      header_x: 'X-Zyla-Key: sml_zyla_...',
      query: 'api_key=sml_zyla_... (optional)',
    },
    rate_limits: {
      basic_rpm_min: 60,
      ultimate_rpm_max: 240,
      default_review_rpm: 90,
    },
    blocked_crypto_examples: [...ZYLA_CRYPTO_BLOCKLIST],
    endpoints: ZYLA_ALLOWLIST.map((path) => ({
      path,
      url: `${baseUrl.replace(/\/$/, '')}${path}`,
      method: 'GET',
    })),
    count: ZYLA_ALLOWLIST.length,
    sam_uei: 'G24VZA4RLMK3',
    cage: '21U51',
    sdvosb: true,
  };
}
