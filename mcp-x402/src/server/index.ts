#!/usr/bin/env node
import { setDefaultResultOrder } from 'dns';
// Stripe checkout was failing in production with a generic connection error
// while other outbound HTTPS calls from the same container worked fine —
// the signature of Node's IPv6-first DNS resolution (default since Node 17)
// hitting a bad path to that one host. Forcing this in code instead of via
// a NODE_OPTIONS env var: a dashboard env var is something I can't verify
// got set correctly, this always applies regardless.
setDefaultResultOrder('ipv4first');

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import cors from 'cors';
import Stripe from 'stripe';
import { resolveAwsMarketplaceCustomer, isEntitledAwsMarketplaceKey, runEntitlementsSelfCheck, getEntitlementsSelfCheckStatus } from './aws/marketplace.js';
import { handleSnsMessage } from './aws/sns-entitlement.js';
import { handleStripeWebhookEvent, getApiKeyForCheckoutSession, isEntitledStripeKey } from './stripe/entitlement.js';
import { runCommunityScan } from './marketing/community.js';
import { registerTools } from './tools/index.js';
import { AuditLogger } from './security/audit.js';
import { RateLimiter } from './security/rate-limit.js';
import { rapidApiGuard } from './security/rapidapi.js';
import { healthHandler } from './health.js';
import { verifyBaseUsdcPayment, alreadyRedeemed, markRedeemed, releaseRedeem } from './payments/verify-inbound.js';
import { facilitatorChain, decodePaymentHeader, type PaymentRequirements } from './payments/facilitators.js';
import { X402Stats } from './security/x402-stats.js';
import { SqueezeOSAPI } from '../lib/sml-api/squeezeos.js';
import { EquitiesHeatmapAPI, OptionsDeltaHeatmapAPI, type DataCredentials } from '../lib/sml-api/equities-heatmap.js';

// Embedded favicon (jet black / neon green SML mark) — served directly, no redirect
const FAVICON_ICO = Buffer.from(
  'AAABAAEAEBAAAAAAIACiAQAAFgAAAIlQTkcNChoKAAAADUlIRFIAAAAQAAAAEAgGAAAAH/P/YQAAAWlJREFUeJytk71KQ0EQhb/Z3XuTgDH4h5DGQgt9AAttRa1sfAxtfQffQkkjNraC9oK9YCtWQSNEMCS5MXvHYnMTozeSwlPN7Oye+TsrgAKIzawpIKB+aE79LBdObGCbPyxQPSriPYjkX9YUjMDrRZdGLUEMuCx/9aTEwlZMCtgJ2RSIMNgloVFLQgVZMG0pqVderhI+7j7BAOkPAg09N296Q9+NomCt0Lzu0ah1pxvAGMGAsbBiKKwYxIH2814JybMfeWJR9bBxW2FxN6aXaGDKS+jBGaF+3uXpuIXYbxV0HvvoToxEICZ/DapgRZjZdENfEBQFMVBat0EkPwrI2pk/iFk9LdO87/Gw/Q7ybY2aQvvR8xfaqz5oxIzOXKbFaNkwtxehIiDjJWRiK29FpF7HtOvEhOBarUx1v8gnygQhkg6S28roxnCIb5cJ8azgCfPIgyo4J9TPOqEy+Y/PlBliJq7/F7K2Ab4A7DWCSg0K90IAAAAASUVORK5CYII=',
  'base64'
);

const VERSION = '1.0.0';

async function createServer(): Promise<McpServer> {
  const server = new McpServer(
    { name: 'mcp-x402', version: VERSION },
    { capabilities: { tools: {} } },
  );
  await registerTools(server);
  return server;
}

async function runStdio(): Promise<void> {
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  AuditLogger.getInstance().info('server_start', { transport: 'stdio', version: VERSION });

  const shutdown = async () => {
    AuditLogger.getInstance().info('server_stop', { transport: 'stdio' });
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep stdio process alive — reconnect on unexpected transport close
  process.stdin.on('end', () => {
    AuditLogger.getInstance().warn('stdio_stdin_end', {});
    process.exit(0);
  });
}

async function runSSE(): Promise<void> {
  const app = express();
  const port = parseInt(process.env['MCP_SSE_PORT'] ?? '3402', 10);

  app.use(cors({ origin: process.env['CORS_ORIGIN'] ?? '*' }));

  // Stripe webhook signature verification needs the RAW request bytes, not
  // the parsed JSON body — must be registered before express.json() below,
  // which would otherwise consume the stream first and leave nothing to
  // verify the signature against.
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
    const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];
    const stripeSecret = process.env['STRIPE_SECRET_KEY'];
    const signature = req.headers['stripe-signature'];
    if (!webhookSecret || !stripeSecret || typeof signature !== 'string') {
      res.status(503).json({ error: 'stripe_webhook_not_configured' });
      return;
    }
    let event: Stripe.Event;
    try {
      const stripe = new Stripe(stripeSecret);
      event = stripe.webhooks.constructEvent(req.body as Buffer, signature, webhookSecret);
    } catch (err) {
      AuditLogger.getInstance().error('stripe_webhook_signature_invalid', { error: String(err) });
      res.status(400).json({ error: 'invalid_signature' });
      return;
    }
    try {
      await handleStripeWebhookEvent(event);
      res.status(200).json({ received: true });
    } catch (err) {
      AuditLogger.getInstance().error('stripe_webhook_handler_failed', { type: event.type, error: String(err) });
      // 500 so Stripe retries — the event was valid, something on our side failed.
      res.status(500).json({ error: 'webhook_handler_failed' });
    }
  });

  // AWS SNS delivers to HTTPS endpoints with Content-Type: text/plain even
  // though the body is real JSON — express.json() below only parses
  // application/json, so this route needs `type: '*/*'` to force-parse
  // regardless of the declared content-type. Registered ahead of the global
  // parser for the same reason the Stripe webhook is.
  app.post('/aws/marketplace/sns', express.json({ type: '*/*', limit: '256kb' }), async (req: Request, res: Response) => {
    try {
      const result = await handleSnsMessage(req.body);
      // 200 for most ok:false cases — SNS retries aggressively on non-2xx and
      // there's no reason to retry a genuinely malformed/forged message.
      if (!result.ok && result.error === 'invalid_signature') {
        res.status(400).json(result);
        return;
      }
      res.status(200).json(result);
    } catch (err) {
      // Something worth AWS retrying (Supabase down, etc.) — 500, not 200.
      AuditLogger.getInstance().error('sns_handler_unhandled', { error: String(err) });
      res.status(500).json({ ok: false, error: 'handler_exception' });
    }
  });

  app.use(express.json({ limit: '1mb' }));
  // AWS Marketplace redirects a buyer's browser to the fulfillment URL as a
  // POST with Content-Type: application/x-www-form-urlencoded — express.json()
  // above ignores that content type, so it needs its own parser.
  app.use(express.urlencoded({ extended: true }));
  app.use(rapidApiGuard);

  // ── In-memory AI agent traffic counter ──────────────────────────────────────
  // Previously matched any UA containing the bare substrings "agent" or "llm" —
  // that's wide enough to catch uptime monitors and generic bots (confirmed
  // live: a plain curl with UA "Uptime-Agent/1.0" hitting /health incremented
  // this), while somehow still MISSING real crawlers: "gpt-4" as a literal
  // substring never matches OpenAI's actual crawler UA "GPTBot", and
  // google-extended/ccbot/bytespider/meta-externalagent weren't listed at all.
  // Replaced with an explicit allowlist of real, documented AI crawler/agent
  // UA tokens instead of a loose "sounds AI-ish" regex.
  const _statsStartMs = Date.now();
  const _agentCounts = { today: 0, allTime: 0 };
  let _agentCountDay = new Date().toDateString();
  const AI_AGENT_UA_TOKENS = [
    'gptbot', 'oai-searchbot', 'chatgpt-user',                 // OpenAI
    'claudebot', 'claude-web', 'anthropic-ai', 'claude-user',  // Anthropic
    'perplexitybot', 'perplexity-user',                        // Perplexity
    'google-extended',                                          // Google AI training
    'ccbot',                                                    // Common Crawl (widely used for AI training sets)
    'bytespider',                                               // ByteDance
    'cohere-ai',                                                // Cohere
    'meta-externalagent', 'meta-externalfetcher',               // Meta
    'diffbot',
    'mcp-client',                                               // self-identifying MCP clients
    'langchain', 'llamaindex', 'crewai', 'autogpt',             // known agent frameworks
  ];
  const _isAiAgent = (ua: string): boolean => {
    const lower = ua.toLowerCase();
    return AI_AGENT_UA_TOKENS.some((token) => lower.includes(token));
  };
  // /health is hit every 30s by Docker's healthcheck + a keepalive cron — that's
  // infrastructure noise, not a visitor, and was the single largest source of
  // false counts under the old regex.
  const AGENT_COUNT_EXEMPT_PATHS = new Set(['/health']);
  app.use((req, _res, next) => {
    if (AGENT_COUNT_EXEMPT_PATHS.has(req.path)) { next(); return; }
    const today = new Date().toDateString();
    if (today !== _agentCountDay) { _agentCounts.today = 0; _agentCountDay = today; }
    if (_isAiAgent(String(req.headers['user-agent'] ?? ''))) { _agentCounts.today++; _agentCounts.allTime++; }
    next();
  });

  const LEVIATHAN_BYPASS_SECRET = process.env['LEVIATHAN_BYPASS_SECRET'] ?? '';
  const SML_API_KEY = process.env['SML_API_KEY'] ?? '';

  // Health endpoint — hit every 30s by Docker healthcheck + keepalive cron
  app.get('/health', healthHandler);

  // Agent traffic stats — polled by dashboard every 60s
  app.get('/api/stats', (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*').json({
      aiAgentsToday: _agentCounts.today,
      aiAgentsAllTime: _agentCounts.allTime,
      uptime_seconds: Math.floor((Date.now() - _statsStartMs) / 1000),
      endpoint_count: 44,
      version: VERSION,
    });
  });

  // Community Scout — real HackerNews search-hit counts for
  // agentswarm-seo.html's "Ad Campaigns" tab, replacing what used to be a
  // static hardcoded list with no backend call at all. Reddit is honestly
  // reported as pending credentials rather than faked — see marketing/community.ts.
  const COMMUNITY_SEARCH_QUERIES = [
    'MCP server trading', 'x402 payment protocol', 'autonomous trading agent',
    'Claude MCP finance', 'squeeze momentum indicator', 'XRPL autonomous agent',
    'RLUSD payment', 'AI agent market data API', 'institutional signals API',
    'MCP server finance', 'pay per call AI API', 'agent micropayment',
    'answer engine optimization AI', 'AEO citation tracking', 'AI agent credit score',
    'GEO generative engine optimization', 'SEO agent swarm',
  ];
  app.get('/api/marketing/community', async (_req, res) => {
    try {
      const result = await runCommunityScan(COMMUNITY_SEARCH_QUERIES);
      res.set('Access-Control-Allow-Origin', '*').json(result);
    } catch (err) {
      AuditLogger.getInstance().error('community_scan_failed', { error: String(err) });
      res.status(502).set('Access-Control-Allow-Origin', '*').json({ scanned: false, error: 'scan_failed' });
    }
  });

  // ── Stripe subscription checkout (Starter/Elite) ────────────────────────────
  // Every /x402/* route above is pay-per-call for autonomous agents. This is the
  // flat-rate human-subscription rail surfaced as two buttons on
  // agentswarm-seo.html, for buyers who want unlimited dashboard access instead
  // of metering every call. Same receiving wallet (SML_PAYMENT_RECEIVER), same
  // brand, one checkout — deliberately consolidated here instead of on a
  // separate throwaway backend so there's exactly one place this can break.
  const STRIPE_PRICE_BY_TIER: Record<string, string | undefined> = {
    starter: process.env['STRIPE_PRICE_STARTER'],
    elite: process.env['STRIPE_PRICE_ELITE'],
  };
  app.post('/api/checkout/create-session', async (req: Request, res: Response) => {
    const stripeSecret = process.env['STRIPE_SECRET_KEY'];
    if (!stripeSecret) {
      res.status(503).set('Access-Control-Allow-Origin', '*').json({ error: 'stripe_not_configured', detail: 'Operator must set STRIPE_SECRET_KEY.' });
      return;
    }
    const tier = typeof req.body?.['tier'] === 'string' && req.body['tier'].toLowerCase() === 'starter' ? 'starter' : 'elite';
    const priceId = STRIPE_PRICE_BY_TIER[tier];
    if (!priceId) {
      res.status(503).set('Access-Control-Allow-Origin', '*').json({ error: 'price_not_configured', detail: `Operator must set STRIPE_PRICE_${tier.toUpperCase()}.` });
      return;
    }
    try {
      const stripe = new Stripe(stripeSecret);
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: 'subscription',
        // {CHECKOUT_SESSION_ID} lets the success page fetch its own API key via
        // GET /api/checkout/session/:id below — the webhook is what actually
        // provisions the key server-side; this is just how the buyer's browser
        // learns about it.
        success_url: 'https://www.scriptmasterlabs.com/agentswarm-seo.html?payment=success&session_id={CHECKOUT_SESSION_ID}',
        cancel_url: 'https://www.scriptmasterlabs.com/agentswarm-seo.html?payment=cancelled',
        metadata: { tier, source: 'agentswarm-seo' },
      });
      res.set('Access-Control-Allow-Origin', '*').json({ checkout_url: session.url });
    } catch (err) {
      // Stripe.errors.StripeConnectionError wraps the real network failure in
      // `.detail`/`.cause` — String(err) alone was only ever showing the generic
      // "connection error, retried 2 times" wrapper, not what actually failed
      // underneath (DNS, TLS, ECONNRESET, etc.). Capturing everything available.
      const e = err as { type?: string; code?: string; detail?: unknown; cause?: unknown; message?: string };
      AuditLogger.getInstance().error('stripe_checkout_error', {
        error: String(err), type: e.type, code: e.code,
        detail: e.detail ? String(e.detail) : undefined,
        cause: e.cause ? String(e.cause) : undefined,
      });
      res.status(500).set('Access-Control-Allow-Origin', '*').json({ error: 'stripe_error', message: String(err) });
    }
  });

  // Success-page key retrieval. Deliberately reads our own table, not Stripe
  // again — the webhook already did the provisioning; a buyer landing here
  // right after the webhook fires (or before it, on a slow network) sees
  // 'processing' and the frontend can retry rather than a bare failure.
  app.get('/api/checkout/session/:sessionId', async (req: Request, res: Response) => {
    const sessionIdParam = req.params['sessionId'];
    const result = await getApiKeyForCheckoutSession(typeof sessionIdParam === 'string' ? sessionIdParam : '');
    if (!result) {
      res.status(202).set('Access-Control-Allow-Origin', '*').json({ status: 'processing', detail: 'Payment received, provisioning your key — this can take a few seconds. Retry shortly.' });
      return;
    }
    res.set('Access-Control-Allow-Origin', '*').json({ status: 'ready', apiKey: result.apiKey, tier: result.tier });
  });

  // Config + last GetEntitlements self-check result — check this before
  // resubmitting the "Update product visibility" request to confirm the
  // audit-satisfying call actually ran and succeeded.
  app.get('/aws/marketplace/status', (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*').json({
      configured: Boolean(process.env['AWS_ACCESS_KEY_ID'] && process.env['AWS_SECRET_ACCESS_KEY']),
      product_code: 'c6g8c5zsvgof5a4rpp6eqlzn',
      last_entitlements_self_check: getEntitlementsSelfCheckStatus(),
    });
  });

  // ── AWS Marketplace fulfillment ──────────────────────────────────────────
  // AWS redirects a buyer's browser here as a POST (x-www-form-urlencoded)
  // right after they subscribe to "Script Master Labs Federal, Medical &
  // Finance MCP (x402)" (prod-lop2m2yjjcs76). This is the third checkout rail
  // alongside Stripe (direct card) and x402 (autonomous agents) — same
  // product, same MCP endpoint, different buyer.
  const awsFulfillmentPage = (body: { ok: boolean; apiKey?: string; error?: string }): string => {
    const inner = body.ok
      ? `<h1>You're in.</h1>
         <p>Your AWS Marketplace subscription is active. Use the key below with the MCP endpoint to skip per-call x402 payment for the life of your subscription.</p>
         <p class="label">MCP Endpoint</p><code>https://mcp-x402.onrender.com/mcp</code>
         <p class="label">Your API Key</p><code>${body.apiKey}</code>
         <p class="label">Header</p><code>X-AWS-MP-Key: ${body.apiKey}</code>
         <p class="hint">Save this key now — it will not be shown again on this page. Full usage docs: <a href="https://mcp-x402.onrender.com/llms.txt">llms.txt</a></p>`
      : `<h1>Something went wrong</h1>
         <p>We couldn't complete provisioning (${body.error ?? 'unknown_error'}). Nothing was charged beyond what AWS Marketplace already processed. Contact support and reference this error code.</p>`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>Script Master Labs — AWS Marketplace</title>
      <style>body{background:#050508;color:#e2e8f0;font-family:'Courier New',monospace;max-width:640px;margin:4rem auto;padding:0 1.5rem;line-height:1.6}
      h1{color:#a78bfa}.label{color:#64748b;font-size:.75rem;text-transform:uppercase;margin-top:1.2rem;margin-bottom:.2rem}
      code{display:block;background:#0d0d14;border:1px solid #1e1e2e;border-radius:6px;padding:.6rem .8rem;color:#10b981;word-break:break-all}
      .hint{color:#64748b;font-size:.8rem;margin-top:1rem}a{color:#a78bfa}</style></head>
      <body>${inner}</body></html>`;
  };
  app.post('/aws/marketplace/resolve', async (req: Request, res: Response) => {
    const token = typeof req.body?.['x-amzn-marketplace-token'] === 'string' ? req.body['x-amzn-marketplace-token'] : '';
    if (!token) {
      res.status(400).send(awsFulfillmentPage({ ok: false, error: 'missing_registration_token' }));
      return;
    }
    const result = await resolveAwsMarketplaceCustomer(token);
    if (!result.ok) {
      res.status(502).send(awsFulfillmentPage({ ok: false, error: result.error }));
      return;
    }
    res.send(awsFulfillmentPage({ ok: true, apiKey: result.apiKey }));
  });

  // Wallet info — shows the server's derived wallet address (safe to expose, no private key)
  app.get('/wallet', async (_req, res) => {
    const { WalletManager } = await import('./payments/wallet.js');
    const wallet = await WalletManager.getInstance().getOrCreateWallet();
    res.json({ address: wallet.address, chain: wallet.chain, note: 'Fund this address with USDC on Base to enable outbound payments.' });
  });

  app.get('/agents.json', (_req, res) => {
    res.sendFile('agents.json', { root: process.cwd() });
  });
  app.get('/llms.txt', (_req, res) => {
    res.sendFile('llms.txt', { root: process.cwd() });
  });
  app.get('/.well-known/agentcard.json', (_req, res) => {
    res.sendFile('.well-known/agentcard.json', { root: process.cwd() });
  });

  // ── x402 discovery resources ──────────────────────────────────────────────
  // Public crawlable HTTP 402 challenges so x402scan / 402 Index / Bazaar can
  // detect and index this server. Authoritative per-tool pricing lives in the
  // sml_discover MCP tool; these emit a spec-correct x402 V2 PaymentRequirements.
  const X402_PAY_TO = process.env['SML_PAYMENT_RECEIVER'] ?? '0x4e14B249D9A4c9c9352D780eCEB508A8eB7a7700';
  const USDC_BASE_ASSET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

  // ── Dual-rail x402 payment gate (institution-grade) ─────────────────────────
  // Rail A (standard x402 "exact" / EIP-3009): client sends `X-PAYMENT`; verified
  //   and settled through a hybrid facilitator chain (x402.org / CDP / partner /
  //   self) — interoperable with every standard x402 client and explorer.
  // Rail B (sovereign): client pays on-chain and sends `X-PAYMENT-TX`; verified
  //   directly on Base via viem, no facilitator, no custody.
  // Both advertised in one 402 `accepts` array; agent picks whichever it can fulfil.
  type PayResult = { ok: true; payer: { rail: string; from: string; tx: string } } | { ok: false };
  // x402 v2 payment challenge, validated against the agentcash/x402scan discovery
  // schema (validatePaymentRequiredDetailed). Three things that crawler requires
  // and that the deployed body was missing:
  //   1. Each accept carries `amount` (v2 field). We keep `maxAmountRequired` too
  //      because our own facilitator chain settles off that field — extra accept
  //      fields are ignored by the validator (its accept schema is non-strict).
  //   2. Top-level `resource` is an OBJECT { url, description, mimeType }, not a string.
  //   3. Input/output JSON schemas live under `extensions.bazaar.schema.properties`,
  //      not inline on the accept. Missing input schema is an ERROR to the crawler.
  // network MUST be the plain x402 network name ('base'), not CAIP-2 ('eip155:8453').
  // The prior comment here claimed a "v2 validator" mandated CAIP-2 and that "the
  // facilitator ignores network" — both wrong: confirmed live against the official
  // x402-fetch client, whose bundled schema rejects 'eip155:8453' outright
  // (ZodError: invalid_enum_value, expected 'base' | 'base-sepolia' | ...) before
  // the client can even attempt payment. This is also the exact field forwarded
  // verbatim into every facilitator's /verify+/settle body (see facilitators.ts),
  // including CDP's, so the wrong value wasn't just a discovery-metadata quirk —
  // it could have been silently blocking the entire standard (X-PAYMENT) rail for
  // every real x402 client that validates its own schema before paying.
  const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const buildAccepts = (resource: string, priceUnits: bigint, description: string, maxTimeoutSeconds = 300): unknown[] => {
    const units = priceUnits.toString();
    return [{
      scheme: 'exact', network: 'base',
      amount: units, maxAmountRequired: units,
      asset: USDC_BASE_ASSET, payTo: X402_PAY_TO, maxTimeoutSeconds,
      resource, description, mimeType: 'application/json',
      extra: { name: 'USD Coin', version: '2' },
    }];
  };
  // extensions.bazaar.schema — the v2 location the crawler reads input/output from.
  // `discoverable: true` is what actually opts a route into CDP's Bazaar index —
  // the schema alone isn't enough. CDP still only catalogs it after the FIRST
  // real payment for this route settles through the CDP facilitator specifically
  // (see facilitatorChain() in payments/facilitators.ts) — schema + flag get you
  // eligible, they don't get you listed by themselves.
  // Bazaar discovery extension. Two consumers, both must pass:
  //  • x402scan / @agentcash/discovery reads extensions.bazaar.schema.properties
  //    .input.properties.{queryParams|body} and .output.properties.example.
  //  • Agentic.Market / CDP Bazaar SDK reads extensions.bazaar.info (the
  //    @rvk_rishikesh/extensions DiscoveryInfo shape) to extract method + params.
  // The `info` block is REQUIRED by the Bazaar SDK — without it the endpoint
  // validates on x402scan but is rejected by Agentic.Market ("Missing bazaar info").
  const isBodyMethod = (m: string): boolean => m === 'POST' || m === 'PUT' || m === 'PATCH';
  // The Bazaar SDK's `info.input.{queryParams|body}` (DiscoveryInfo shape) wants a
  // flat map of ACTUAL typed example values, one per param — NOT the richer
  // {type, description, required, ...} descriptor object that the OTHER consumer
  // (x402scan's schema.properties.input.properties) correctly expects, and NOT a
  // type-NAME string either. Confirmed by two separate live validator errors:
  // reusing the rich descriptor gave "Invalid type. Expected: string, given:
  // object" for a string param; putting the type name itself (e.g. the string
  // "integer") gave "Expected: integer, given: string" for an integer param.
  // Both are only consistent with "the value must be a real instance of the
  // declared type" — so an integer param needs an actual number, not the word
  // "integer". Uses each param's own `example`/`default` when present (most
  // already carry one), else a type-appropriate zero value.
  const exampleForParam = (prop: unknown): unknown => {
    if (!isRecord(prop)) return '';
    if ('example' in prop) return prop['example'];
    if ('default' in prop) return prop['default'];
    switch (prop['type']) {
      case 'integer':
      case 'number': return 0;
      case 'boolean': return false;
      case 'array': return [];
      case 'object': return {};
      default: return '';
    }
  };
  const flattenParamTypes = (properties: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(properties)) {
      out[k] = exampleForParam(v);
    }
    return out;
  };
  const buildBazaarExtensions = (inputSchema: unknown, outputSchema: unknown): Record<string, unknown> => {
    const oi = isRecord(outputSchema) && isRecord(outputSchema['input']) ? outputSchema['input'] : {};
    const method = typeof oi['method'] === 'string' ? oi['method'] : 'GET';
    const body = isBodyMethod(method);
    const params = isRecord(inputSchema) && isRecord(inputSchema['properties']) ? inputSchema['properties'] : {};
    const flatParams = flattenParamTypes(params);
    const example = isRecord(outputSchema) && isRecord(outputSchema['output']) ? outputSchema['output'] : {};
    const info = body
      ? { input: { type: 'http', method, bodyType: 'json', body: flatParams }, output: { example } }
      : { input: { type: 'http', method, queryParams: flatParams }, output: { example } };
    const inputProps = body
      ? { type: { type: 'string', const: 'http' }, method: { type: 'string' }, bodyType: { type: 'string' }, body: isRecord(inputSchema) ? inputSchema : { type: 'object' } }
      : { type: { type: 'string', const: 'http' }, method: { type: 'string' }, queryParams: isRecord(inputSchema) ? inputSchema : { type: 'object' } };
    return {
      bazaar: {
        discoverable: true,
        info,
        schema: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          properties: {
            input: { type: 'object', properties: inputProps, required: body ? ['type', 'method', 'bodyType', 'body'] : ['type', 'method'] },
            output: { properties: { example } },
          },
          required: ['input'],
        },
      },
    };
  };
  const send402 = (res: Response, challenge: Record<string, unknown>, header402: string, extra?: Record<string, unknown>): void => {
    const body = extra ? { ...challenge, ...extra } : challenge;
    res.status(402)
      .set('X-PAYMENT-REQUIRED', header402)
      .set('PAYMENT-REQUIRED', header402)
      .set('Access-Control-Expose-Headers', 'X-PAYMENT-REQUIRED, PAYMENT-REQUIRED')
      .set('Access-Control-Allow-Origin', '*')
      .json(body);
  };
  const requirePayment = async (req: Request, res: Response, opts: { resource: string; priceUnits: bigint; description: string; inputSchema: unknown; outputSchema: unknown }): Promise<PayResult> => {
    const accepts = buildAccepts(opts.resource, opts.priceUnits, opts.description);
    const challenge: Record<string, unknown> = {
      x402Version: 2,
      error: 'payment_required',
      resource: { url: opts.resource, description: opts.description, mimeType: 'application/json' },
      accepts,
      extensions: buildBazaarExtensions(opts.inputSchema, opts.outputSchema),
    };
    const header402 = Buffer.from(JSON.stringify(challenge)).toString('base64');

    const xPayment = typeof req.headers['x-payment'] === 'string' ? req.headers['x-payment'] : '';
    const txHash = typeof req.headers['x-payment-tx'] === 'string' ? req.headers['x-payment-tx'] : '';

    // LEVIATHAN bypass — Virtuals Protocol USDC already settled on-chain
    if (LEVIATHAN_BYPASS_SECRET && req.headers['x-leviathan-key'] === LEVIATHAN_BYPASS_SECRET) {
      return { ok: true, payer: { rail: 'leviathan', from: 'did:leviathan:acp:scriptmasterlabs', tx: '' } };
    }

    // Operator bypass — the operator's own private tools (e.g. the trading
    // dashboard at scriptmasterlabs.com) authenticate with the same SML_API_KEY
    // already used as the operator-key bypass for SqueezeOS calls, so there's
    // only one operator secret to manage instead of two.
    if (SML_API_KEY && req.headers['x-operator-key'] === SML_API_KEY) {
      return { ok: true, payer: { rail: 'operator', from: 'did:sml:operator', tx: '' } };
    }

    // AWS Marketplace bypass — customer already paying AWS a flat monthly fee
    // via the SaaS Contract product (prod-lop2m2yjjcs76); their key (issued at
    // /aws/marketplace/resolve) skips the per-call x402 charge entirely.
    const awsMpKey = typeof req.headers['x-aws-mp-key'] === 'string' ? req.headers['x-aws-mp-key'] : '';
    if (awsMpKey && await isEntitledAwsMarketplaceKey(awsMpKey)) {
      return { ok: true, payer: { rail: 'aws-marketplace', from: `aws:${awsMpKey.slice(0, 16)}…`, tx: '' } };
    }

    // Stripe subscription bypass — customer already paying a flat monthly fee
    // via the Starter/Elite checkout (agentswarm-seo.html); their key (issued
    // by the checkout.session.completed webhook) skips the per-call x402
    // charge entirely, same mechanism as the AWS Marketplace bypass above.
    const stripeKey = typeof req.headers['x-stripe-key'] === 'string' ? req.headers['x-stripe-key'] : '';
    if (stripeKey && await isEntitledStripeKey(stripeKey)) {
      return { ok: true, payer: { rail: 'stripe', from: `stripe:${stripeKey.slice(0, 16)}…`, tx: '' } };
    }

    // Rail A — standard EIP-3009 via hybrid facilitator chain
    if (xPayment) {
      const payload = decodePaymentHeader(xPayment);
      if (!payload) { send402(res, challenge, header402, { error: 'invalid_payment_payload' }); return { ok: false }; }
      const result = await facilitatorChain().process(payload, accepts[0] as PaymentRequirements);
      if (!result.success) { send402(res, challenge, header402, { error: 'payment_unsettled', detail: result.errorReason ?? '', attempts: result.attempts ?? [], receivedPayload: { x402Version: payload.x402Version, scheme: payload.scheme, network: payload.network } }); return { ok: false }; }
      return { ok: true, payer: { rail: `standard:${result.facilitator ?? ''}`, from: result.payer ?? payload.payload.authorization.from, tx: result.transaction ?? '' } };
    }

    // Rail B — sovereign on-chain tx-hash
    if (txHash) {
      if (alreadyRedeemed(txHash)) { send402(res, challenge, header402, { error: 'payment_already_redeemed', detail: 'This transaction hash was already used. Send a new payment.' }); return { ok: false }; }
      const v = await verifyBaseUsdcPayment({ txHash, payTo: X402_PAY_TO, minAmountUnits: opts.priceUnits });
      if (!v.ok) { send402(res, challenge, header402, { error: 'payment_unverified', detail: v.error ?? '' }); return { ok: false }; }
      markRedeemed(txHash);
      return { ok: true, payer: { rail: 'sovereign', from: v.from ?? '', tx: txHash } };
    }

    send402(res, challenge, header402);
    return { ok: false };
  };
  // BYOK: a caller's own upstream-provider key (sent as a request header)
  // always takes priority over this server's own env-configured key — the
  // operator never burns their own shared, rate-limited registration on
  // another caller's heavy usage. Falls back to the server's key (or an
  // explicit `fallback`, e.g. FEC's public DEMO_KEY) when the caller supplies
  // nothing.
  const byokKey = (req: Request, header: string, envKey: string, fallback?: string): string | undefined => {
    const v = req.headers[header];
    if (typeof v === 'string' && v.trim()) return v.trim();
    return process.env[envKey] ?? fallback;
  };
  const inlineDiscover402 = (resource: string, description: string): Record<string, unknown> => ({
    x402Version: 2, error: 'payment_required',
    resource: { url: resource, description, mimeType: 'application/json' },
    accepts: buildAccepts(resource, 20000n, description, 120),
    extensions: buildBazaarExtensions(
      { type: 'object', properties: { tool: { type: 'string', description: 'Tool name to price/call. See GET /x402/tool/{name}.' } } },
      { type: 'object', description: 'Per-tool x402 payment challenge.' },
    ),
  });
  app.get('/x402/discover', (req, res) => {
    const resource = `https://${req.headers.host ?? 'mcp-x402.onrender.com'}${req.originalUrl}`;
    const challenge = inlineDiscover402(resource, 'SML pay-per-call data tools — federal grants/contracts, market intel, SEC, FTD. Per-tool pricing via the sml_discover MCP tool.');
    const h = Buffer.from(JSON.stringify(challenge)).toString('base64');
    res.status(402).set('X-PAYMENT-REQUIRED', h).set('PAYMENT-REQUIRED', h).set('Access-Control-Expose-Headers', 'X-PAYMENT-REQUIRED, PAYMENT-REQUIRED').set('Access-Control-Allow-Origin', '*').json(challenge);
  });
  app.get('/x402/tool/:name', (req, res) => {
    const resource = `https://${req.headers.host ?? 'mcp-x402.onrender.com'}${req.originalUrl}`;
    const challenge = inlineDiscover402(resource, `Paid SML tool ${req.params.name} — pay-per-call via x402, USDC on Base.`);
    const h = Buffer.from(JSON.stringify(challenge)).toString('base64');
    res.status(402).set('X-PAYMENT-REQUIRED', h).set('PAYMENT-REQUIRED', h).set('Access-Control-Expose-Headers', 'X-PAYMENT-REQUIRED, PAYMENT-REQUIRED').set('Access-Control-Allow-Origin', '*').json(challenge);
  });

  // ── REAL fulfilling x402 endpoint: live federal grant search ──────────────
  // Unpaid → 402 challenge. Paid (USDC on Base, verified on-chain) → real data.
  const GRANTS_PRICE_UNITS = 20000n; // 0.02 USDC (6 decimals)
  app.get('/x402/grants', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/grants`;
    const keyword = typeof req.query['keyword'] === 'string' ? req.query['keyword']
      : (typeof req.query['q'] === 'string' ? req.query['q'] : '');
    const rows = Math.min(Math.max(parseInt(String(req.query['rows'] ?? '10'), 10) || 10, 1), 50);
    const inputSchema = { type: 'object', properties: { keyword: { type: 'string', description: 'Search keywords or CFDA/assistance-listing number.' }, rows: { type: 'integer', minimum: 1, maximum: 50, default: 10 } }, required: ['keyword'] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { keyword: { type: 'string', required: true, description: 'Search keywords or CFDA number.' }, rows: { type: 'integer', required: false } } }, output: null };

    const pay = await requirePayment(req, res, { resource, priceUnits: GRANTS_PRICE_UNITS, description: 'Live U.S. federal grant search (Grants.gov Search2). Pay 0.02 USDC on Base via X-PAYMENT (standard) or X-PAYMENT-TX (sovereign).', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!keyword) {
      if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx);
      return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_keyword', detail: 'Payment verified. Add ?keyword= and retry with the same payment.' });
    }
    try {
      const r = await fetch('https://api.grants.gov/v1/api/search2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword, oppStatuses: 'posted', rows }) });
      if (!r.ok) {
        if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx);
        return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'grants_api_error', status: r.status });
      }
      const j = await r.json() as { data?: { hitCount?: number; oppHits?: unknown[] } };
      const results = j.data?.oppHits ?? [];
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'grants.gov/search2', total: j.data?.hitCount ?? results.length, results, _paid: pay.payer });
    } catch (err) {
      if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx);
      return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'grants_fetch_failed', message: String(err) });
    }
  });

  // ── REAL fulfilling x402 endpoint: SDVOSB / set-aside firm finder (SAM.gov) ─
  const FIRMS_PRICE_UNITS = 80000n; // 0.08 USDC
  const SET_ASIDE_CODE: Record<string, string> = { SDVOSB: 'QF', WOSB: '8W', SDB: '27', MINORITY: '23' };
  interface SamEntity { entityRegistration?: { legalBusinessName?: string; ueiSAM?: string; cageCode?: string; registrationStatus?: string; registrationExpirationDate?: string }; coreData?: { physicalAddress?: { city?: string; stateOrProvinceCode?: string }; businessTypes?: { businessTypeList?: Array<{ businessTypeCode?: string; businessTypeDesc?: string }> } }; }
  interface SamResponse { totalRecords?: number; entityData?: SamEntity[] }
  app.get('/x402/firms', async (req, res) => {
    const samKey = byokKey(req, 'x-sam-key', 'SAM_API_KEY');
    if (!samKey) {
      return res.status(503).set('Access-Control-Allow-Origin', '*').json({ error: 'service_unconfigured', detail: 'Operator must set SAM_API_KEY (free at sam.gov). No payment taken.' });
    }
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/firms`;
    const naics = typeof req.query['naics'] === 'string' ? req.query['naics'] : '';
    const state = typeof req.query['state'] === 'string' ? req.query['state'].toUpperCase().slice(0, 2) : '';
    const setAsideRaw = typeof req.query['set_aside'] === 'string' ? req.query['set_aside'].toUpperCase() : 'SDVOSB';
    const setAside = setAsideRaw in SET_ASIDE_CODE ? setAsideRaw : 'SDVOSB';
    const rows = Math.min(Math.max(parseInt(String(req.query['rows'] ?? '10'), 10) || 10, 1), 25);
    const inputSchema = { type: 'object', properties: { naics: { type: 'string', description: '6-digit NAICS code (required).' }, state: { type: 'string', description: '2-letter state code (optional).' }, set_aside: { type: 'string', enum: Object.keys(SET_ASIDE_CODE), default: 'SDVOSB' }, rows: { type: 'integer', minimum: 1, maximum: 25, default: 10 } }, required: ['naics'] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { naics: { type: 'string', required: true }, state: { type: 'string', required: false }, set_aside: { type: 'string', required: false }, rows: { type: 'integer', required: false } } }, output: null };

    const pay = await requirePayment(req, res, { resource, priceUnits: FIRMS_PRICE_UNITS, description: 'Find self-certified SDVOSB/WOSB/SDB/minority firms by NAICS + state (SAM.gov). Pay 0.08 USDC on Base via X-PAYMENT (standard) or X-PAYMENT-TX (sovereign).', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!/^\d{6}$/.test(naics)) {
      if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx);
      return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_or_invalid_naics', detail: 'Payment verified. Add ?naics=<6-digit> and retry with the same payment.' });
    }
    try {
      const p = new URLSearchParams({ api_key: samKey, primaryNaics: naics, businessTypeCode: SET_ASIDE_CODE[setAside] ?? 'QF', registrationStatus: 'A', includeSections: 'entityRegistration,coreData', page: '0', size: String(rows) });
      if (state) p.set('physicalAddressProvinceOrStateCode', state);
      const r = await fetch(`https://api.sam.gov/entity-information/v3/entities?${p.toString()}`, { headers: { Accept: 'application/json' } });
      if (!r.ok) {
        if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx);
        return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'sam_api_error', status: r.status });
      }
      const j = await r.json() as SamResponse;
      const firms = (j.entityData ?? []).map((e) => {
        const er = e.entityRegistration ?? {};
        const cd = e.coreData ?? {};
        const addr = cd.physicalAddress ?? {};
        const types = (cd.businessTypes?.businessTypeList ?? []).map((t) => t.businessTypeCode ?? '').filter(Boolean);
        return { name: er.legalBusinessName ?? '', uei: er.ueiSAM ?? '', cage: er.cageCode ?? '', status: er.registrationStatus ?? '', registration_expires: er.registrationExpirationDate ?? '', city: addr.city ?? '', state: addr.stateOrProvinceCode ?? '', business_type_codes: types };
      });
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'sam.gov/entity-information/v3', query: { naics, state: state || 'any', set_aside: setAside, code: SET_ASIDE_CODE[setAside] }, total: j.totalRecords ?? firms.length, count: firms.length, firms, _disclaimer: 'Socioeconomic flags here are SELF-CERTIFIED in SAM.gov. SBA-certified 8(a)/HUBZone status is not in SAM — verify at search.certifications.sba.gov.', _paid: pay.payer });
    } catch (err) {
      if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx);
      return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'sam_fetch_failed', message: String(err) });
    }
  });

  // ── REAL fulfilling x402 endpoint: federal market intelligence (USAspending) ─
  const MARKET_PRICE_UNITS = 300000n; // 0.30 USDC
  app.get('/x402/market', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/market`;
    const naics = typeof req.query['naics'] === 'string' ? req.query['naics'] : '';
    const years = Math.min(Math.max(parseInt(String(req.query['years'] ?? '3'), 10) || 3, 1), 10);
    const inputSchema = { type: 'object', properties: { naics: { type: 'string', description: '6-digit NAICS code (required).' }, years: { type: 'integer', minimum: 1, maximum: 10, default: 3 } }, required: ['naics'] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { naics: { type: 'string', required: true }, years: { type: 'integer', required: false } } }, output: null };

    const pay = await requirePayment(req, res, { resource, priceUnits: MARKET_PRICE_UNITS, description: 'Federal contract market intelligence by NAICS (USAspending): top incumbents + buying agencies + total obligated. Pay 0.30 USDC on Base via X-PAYMENT (standard) or X-PAYMENT-TX (sovereign).', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!/^\d{6}$/.test(naics)) {
      if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx);
      return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_or_invalid_naics', detail: 'Payment verified. Add ?naics=<6-digit> and retry with the same payment.' });
    }
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - years * 365 * 86400000).toISOString().slice(0, 10);
    const usaCat = async (category: string, limit: number): Promise<Array<{ name: string; total_obligated_usd: number }>> => {
      const body = { filters: { award_type_codes: ['A', 'B', 'C', 'D'], naics_codes: [naics], time_period: [{ start_date: start, end_date: end }] }, category, limit, page: 1 };
      const r = await fetch(`https://api.usaspending.gov/api/v2/search/spending_by_category/${category}/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`${category} HTTP ${r.status}`);
      const j = await r.json() as { results?: Array<{ name?: string; amount?: number }> };
      return (j.results ?? []).map((x) => ({ name: x.name ?? '', total_obligated_usd: Math.round(x.amount ?? 0) }));
    };
    try {
      const [incumbents, agencies] = await Promise.all([usaCat('recipient', 8), usaCat('awarding_agency', 8)]);
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'usaspending.gov/api/v2', naics, window: { start_date: start, end_date: end, years }, award_types: 'prime contracts (A,B,C,D)', top_incumbents: incumbents, top_buying_agencies: agencies, _note: 'Obligated $ for prime contract awards in the window. Use for capture targeting and competitor analysis.', _paid: pay.payer });
    } catch (err) {
      if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx);
      return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'usaspending_error', message: String(err) });
    }
  });

  // ── Medical reference endpoints (keyless: openFDA + NPPES) ──────────────────
  const cleanTerm = (s: string): string => s.replace(/[^a-zA-Z0-9 .\-]/g, '').trim().slice(0, 60);

  // 1) FDA drug label lookup — $0.05
  app.get('/x402/drug-label', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/drug-label`;
    const drug = cleanTerm(typeof req.query['drug'] === 'string' ? req.query['drug'] : '');
    const inputSchema = { type: 'object', properties: { drug: { type: 'string', description: 'Brand or generic drug name (required).' } }, required: ['drug'] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { drug: { type: 'string', required: true } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 50000n, description: 'FDA drug label lookup (openFDA): indications, dosage, warnings, interactions. Pay 0.05 USDC on Base via X-PAYMENT (standard) or X-PAYMENT-TX (sovereign).', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!drug) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_drug', detail: 'Payment verified. Add ?drug= and retry with the same payment.' }); }
    try {
      const fdaKey = byokKey(req, 'x-openfda-key', 'OPENFDA_API_KEY');
      const p = new URLSearchParams({ search: `openfda.brand_name:"${drug}" OR openfda.generic_name:"${drug}"`, limit: '1' });
      if (fdaKey) p.set('api_key', fdaKey);
      const r = await fetch(`https://api.fda.gov/drug/label.json?${p.toString()}`);
      if (r.status === 404) return res.set('Access-Control-Allow-Origin', '*').json({ source: 'openfda/drug/label', drug, found: false, label: null, _disclaimer: 'FDA label reference data. Not medical advice.', _paid: pay.payer });
      if (!r.ok) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'openfda_error', status: r.status }); }
      const j = await r.json() as { results?: Array<Record<string, unknown>> };
      const x = (j.results ?? [])[0] ?? {};
      const pick = (k: string): string | undefined => { const v = x[k]; return Array.isArray(v) ? (v as unknown[]).map(String).join(' ').slice(0, 1200) : undefined; };
      const openfda = (x['openfda'] ?? {}) as Record<string, unknown>;
      const brandArr = openfda['brand_name'];
      const brand = Array.isArray(brandArr) && brandArr.length > 0 ? String(brandArr[0]) : drug;
      const label = { brand, indications: pick('indications_and_usage'), dosage: pick('dosage_and_administration'), warnings: pick('boxed_warning') ?? pick('warnings'), interactions: pick('drug_interactions'), adverse_reactions: pick('adverse_reactions') };
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'openfda/drug/label', drug, found: true, label, _disclaimer: 'FDA label reference data. Not medical advice.', _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'openfda_fetch_failed', message: String(err) }); }
  });

  // 2) FDA drug recall / enforcement search — $0.08
  app.get('/x402/drug-recall', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/drug-recall`;
    const drug = cleanTerm(typeof req.query['drug'] === 'string' ? req.query['drug'] : '');
    const limit = Math.min(Math.max(parseInt(String(req.query['limit'] ?? '5'), 10) || 5, 1), 20);
    const inputSchema = { type: 'object', properties: { drug: { type: 'string', description: 'Drug name (required).' }, limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 } }, required: ['drug'] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { drug: { type: 'string', required: true }, limit: { type: 'integer', required: false } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 80000n, description: 'FDA drug recall/enforcement search (openFDA): reason, classification, status, recalling firm. Pay 0.08 USDC on Base via X-PAYMENT (standard) or X-PAYMENT-TX (sovereign).', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!drug) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_drug', detail: 'Payment verified. Add ?drug= and retry with the same payment.' }); }
    try {
      const fdaKey = byokKey(req, 'x-openfda-key', 'OPENFDA_API_KEY');
      const p = new URLSearchParams({ search: `openfda.brand_name:"${drug}" OR openfda.generic_name:"${drug}" OR product_description:"${drug}"`, limit: String(limit), sort: 'recall_initiation_date:desc' });
      if (fdaKey) p.set('api_key', fdaKey);
      const r = await fetch(`https://api.fda.gov/drug/enforcement.json?${p.toString()}`);
      if (r.status === 404) return res.set('Access-Control-Allow-Origin', '*').json({ source: 'openfda/drug/enforcement', drug, count: 0, recalls: [], _disclaimer: 'FDA enforcement reference data. Not medical advice.', _paid: pay.payer });
      if (!r.ok) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'openfda_error', status: r.status }); }
      const j = await r.json() as { results?: Array<Record<string, unknown>> };
      const g = (o: Record<string, unknown>, k: string, n = 200): string => { const v = o[k]; return typeof v === 'string' ? v.slice(0, n) : ''; };
      const recalls = (j.results ?? []).map((o) => ({ reason: g(o, 'reason_for_recall', 240), classification: g(o, 'classification', 20), status: g(o, 'status', 20), initiated: g(o, 'recall_initiation_date', 10), firm: g(o, 'recalling_firm', 80), product: g(o, 'product_description', 160), distribution: g(o, 'distribution_pattern', 120), type: g(o, 'voluntary_mandated', 40) }));
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'openfda/drug/enforcement', drug, count: recalls.length, recalls, _disclaimer: 'FDA enforcement reference data. Not medical advice.', _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'openfda_fetch_failed', message: String(err) }); }
  });

  // 3) NPPES provider (NPI) lookup — $0.05
  interface NpiResult { number?: number | string; enumeration_type?: string; basic?: { first_name?: string; last_name?: string; organization_name?: string; credential?: string }; taxonomies?: Array<{ desc?: string; primary?: boolean; state?: string }>; addresses?: Array<{ address_1?: string; city?: string; state?: string; postal_code?: string; telephone_number?: string; address_purpose?: string }> }
  app.get('/x402/npi', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/npi`;
    const first = cleanTerm(typeof req.query['first_name'] === 'string' ? req.query['first_name'] : '');
    const last = cleanTerm(typeof req.query['last_name'] === 'string' ? req.query['last_name'] : '');
    const org = cleanTerm(typeof req.query['organization_name'] === 'string' ? req.query['organization_name'] : '');
    const state = (typeof req.query['state'] === 'string' ? req.query['state'].toUpperCase().slice(0, 2) : '');
    const specialty = cleanTerm(typeof req.query['specialty'] === 'string' ? req.query['specialty'] : '');
    const limit = Math.min(Math.max(parseInt(String(req.query['limit'] ?? '10'), 10) || 10, 1), 20);
    const inputSchema = { type: 'object', properties: { last_name: { type: 'string' }, first_name: { type: 'string' }, organization_name: { type: 'string' }, state: { type: 'string', description: '2-letter state code.' }, specialty: { type: 'string', description: 'Taxonomy description, e.g. Cardiology.' }, limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 } }, required: [] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { last_name: { type: 'string', required: false }, organization_name: { type: 'string', required: false }, specialty: { type: 'string', required: false }, state: { type: 'string', required: false } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 50000n, description: 'NPPES provider (NPI) lookup: NPI number, name, specialty, location, phone. Provide last_name, organization_name, or specialty. Pay 0.05 USDC on Base via X-PAYMENT (standard) or X-PAYMENT-TX (sovereign).', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!last && !org && !specialty) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_query', detail: 'Payment verified. Provide last_name, organization_name, or specialty and retry with the same payment.' }); }
    try {
      const p = new URLSearchParams({ version: '2.1', limit: String(limit) });
      if (first) p.set('first_name', first);
      if (last) p.set('last_name', last);
      if (org) p.set('organization_name', org);
      if (state) p.set('state', state);
      if (specialty) p.set('taxonomy_description', specialty);
      const r = await fetch(`https://npiregistry.cms.hhs.gov/api/?${p.toString()}`);
      if (!r.ok) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'nppes_error', status: r.status }); }
      const j = await r.json() as { result_count?: number; results?: NpiResult[] };
      const providers = (j.results ?? []).map((o) => {
        const b = o.basic ?? {};
        const tax = (o.taxonomies ?? []).find((t) => t.primary) ?? (o.taxonomies ?? [])[0] ?? {};
        const loc = (o.addresses ?? []).find((a) => a.address_purpose === 'LOCATION') ?? (o.addresses ?? [])[0] ?? {};
        const name = o.enumeration_type === 'NPI-2' ? (b.organization_name ?? '') : `${b.first_name ?? ''} ${b.last_name ?? ''}`.trim();
        return { npi: String(o.number ?? ''), type: o.enumeration_type === 'NPI-2' ? 'organization' : 'individual', name, credential: b.credential ?? '', specialty: tax.desc ?? '', city: loc.city ?? '', state: loc.state ?? '', phone: loc.telephone_number ?? '' };
      });
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'nppes/npi-registry', count: j.result_count ?? providers.length, providers, _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'nppes_fetch_failed', message: String(err) }); }
  });

  // ── /x402/clinical-trials — ClinicalTrials.gov APIv2, keyless, $0.08 ─────────
  interface CtStudy { protocolSection?: { identificationModule?: { nctId?: string; briefTitle?: string; officialTitle?: string }; statusModule?: { overallStatus?: string; startDateStruct?: { date?: string }; primaryCompletionDateStruct?: { date?: string } }; conditionsModule?: { conditions?: string[] }; designModule?: { phases?: string[]; enrollmentInfo?: { count?: number } }; descriptionModule?: { briefSummary?: string }; sponsorCollaboratorsModule?: { leadSponsor?: { name?: string } } } }
  app.get('/x402/clinical-trials', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/clinical-trials`;
    const term = cleanTerm(typeof req.query['term'] === 'string' ? req.query['term'] : '');
    const condition = cleanTerm(typeof req.query['condition'] === 'string' ? req.query['condition'] : '');
    const status = typeof req.query['status'] === 'string' ? req.query['status'].toUpperCase() : '';
    const validStatus: Record<string, string> = { RECRUITING: 'RECRUITING', ACTIVE: 'ACTIVE_NOT_RECRUITING', COMPLETED: 'COMPLETED', ALL: '' };
    const ctStatus = validStatus[status] ?? 'RECRUITING';
    const rows = Math.min(Math.max(parseInt(String(req.query['rows'] ?? '10'), 10) || 10, 1), 25);
    const inputSchema = { type: 'object', properties: { term: { type: 'string', description: 'Drug, sponsor, or keyword (required if no condition).' }, condition: { type: 'string', description: 'Disease or condition (e.g. diabetes).' }, status: { type: 'string', enum: ['RECRUITING', 'ACTIVE', 'COMPLETED', 'ALL'], default: 'RECRUITING' }, rows: { type: 'integer', minimum: 1, maximum: 25, default: 10 } }, required: [] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { term: { type: 'string', required: false }, condition: { type: 'string', required: false }, status: { type: 'string', required: false } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 80000n, description: 'Clinical trial search (ClinicalTrials.gov APIv2): NCT ID, title, status, phase, enrollment, sponsor, conditions. Pay 0.08 USDC on Base via X-PAYMENT (standard) or X-PAYMENT-TX (sovereign).', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!term && !condition) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_query', detail: 'Payment verified. Add ?term= or ?condition= and retry with the same payment.' }); }
    try {
      const p = new URLSearchParams({ pageSize: String(rows) });
      const q = [term, condition].filter(Boolean).join(' ');
      if (q) p.set('query.term', q);
      if (ctStatus) p.set('filter.overallStatus', ctStatus);
      const r = await fetch(`https://clinicaltrials.gov/api/v2/studies?${p.toString()}`, { headers: { Accept: 'application/json' } });
      if (!r.ok) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'clinicaltrials_error', status: r.status }); }
      const j = await r.json() as { totalCount?: number; studies?: CtStudy[] };
      const trials = (j.studies ?? []).map((st) => {
        const ps = st.protocolSection ?? {};
        const im = ps.identificationModule ?? {}; const sm = ps.statusModule ?? {}; const cm = ps.conditionsModule ?? {}; const dm = ps.designModule ?? {}; const desc = ps.descriptionModule ?? {}; const sp = ps.sponsorCollaboratorsModule ?? {};
        return { nct_id: im.nctId ?? '', title: im.briefTitle ?? '', status: sm.overallStatus ?? '', phase: (dm.phases ?? []).join(', '), enrollment: dm.enrollmentInfo?.count ?? null, conditions: cm.conditions ?? [], sponsor: sp.leadSponsor?.name ?? '', start_date: sm.startDateStruct?.date ?? '', completion_date: sm.primaryCompletionDateStruct?.date ?? '', summary: (desc.briefSummary ?? '').slice(0, 400), url: im.nctId ? `https://clinicaltrials.gov/study/${im.nctId}` : '' };
      });
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'clinicaltrials.gov/api/v2', query: { term, condition, status: ctStatus || 'ALL' }, total: j.totalCount ?? trials.length, count: trials.length, trials, _disclaimer: 'Clinical trial reference data. Not medical advice.', _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'clinicaltrials_fetch_failed', message: String(err) }); }
  });

  // ── /x402/insider-trades — SEC EDGAR Form 4, keyless, $0.20 ────────────────
  interface EdgarHit { _id?: string; _source?: { display_names?: string[]; period_ending?: string; ciks?: string[]; file_num?: string[] } }
  const CIK_CACHE: Record<string, string> = {};
  async function resolveTickerToCik(ticker: string): Promise<string | null> {
    const t = ticker.toUpperCase();
    if (CIK_CACHE[t]) return CIK_CACHE[t] ?? null;
    try {
      const r = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: { 'User-Agent': 'ScriptMasterLabs ScriptMasterLabs@gmail.com' } });
      if (!r.ok) return null;
      const d = await r.json() as Record<string, { cik_str: number; ticker: string }>;
      for (const v of Object.values(d)) {
        const cikStr = String(v.cik_str).padStart(10, '0');
        CIK_CACHE[v.ticker.toUpperCase()] = cikStr;
      }
      return CIK_CACHE[t] ?? null;
    } catch { return null; }
  }
  app.get('/x402/insider-trades', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/insider-trades`;
    const ticker = cleanTerm(typeof req.query['ticker'] === 'string' ? req.query['ticker'] : '').toUpperCase();
    const days = Math.min(Math.max(parseInt(String(req.query['days'] ?? '30'), 10) || 30, 1), 90);
    const limit = Math.min(Math.max(parseInt(String(req.query['limit'] ?? '10'), 10) || 10, 1), 25);
    const inputSchema = { type: 'object', properties: { ticker: { type: 'string', description: 'Stock ticker symbol (required). e.g. TSLA, AMC, GME.' }, days: { type: 'integer', minimum: 1, maximum: 90, default: 30, description: 'Lookback window in days.' }, limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 } }, required: ['ticker'] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { ticker: { type: 'string', required: true }, days: { type: 'integer', required: false }, limit: { type: 'integer', required: false } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 200000n, description: 'SEC EDGAR insider trades (Form 4): executive buys/sells by ticker. Pay 0.20 USDC on Base via X-PAYMENT (standard) or X-PAYMENT-TX (sovereign).', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!ticker || !/^[A-Z]{1,5}$/.test(ticker)) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_or_invalid_ticker', detail: 'Payment verified. Add ?ticker=TSLA (1-5 uppercase letters) and retry with the same payment.' }); }
    try {
      const cik = await resolveTickerToCik(ticker);
      if (!cik) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(404).set('Access-Control-Allow-Origin', '*').json({ error: 'ticker_not_found', ticker, detail: 'No CIK found for this ticker in SEC company registry.' }); }
      const end = new Date().toISOString().slice(0, 10);
      const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const p = new URLSearchParams({ forms: '4', dateRange: 'custom', startdt: start, enddt: end });
      const searchUrl = `https://efts.sec.gov/LATEST/search-index?${p.toString()}&hits.hits.total=true`;
      const r = await fetch(searchUrl, { headers: { 'User-Agent': 'ScriptMasterLabs ScriptMasterLabs@gmail.com' } });
      if (!r.ok) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'edgar_search_error', status: r.status }); }
      const j = await r.json() as { hits?: { total?: { value?: number }; hits?: EdgarHit[] } };
      const allHits = j.hits?.hits ?? [];
      const cikShort = cik.replace(/^0+/, '');
      const filtered = allHits.filter((h) => (h._source?.ciks ?? []).some((c) => c.replace(/^0+/, '') === cikShort));
      // fetch the issuer's own submissions for richer data
      const subR = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: { 'User-Agent': 'ScriptMasterLabs ScriptMasterLabs@gmail.com' } });
      let trades: unknown[] = [];
      if (subR.ok) {
        const sub = await subR.json() as { name?: string; filings?: { recent?: { form?: string[]; filingDate?: string[]; primaryDocument?: string[]; accessionNumber?: string[] } } };
        const rec = sub.filings?.recent ?? {};
        const forms = rec.form ?? []; const dates = rec.filingDate ?? []; const docs = rec.primaryDocument ?? []; const acc = rec.accessionNumber ?? [];
        const cutoff = start;
        trades = forms.map((f, i) => ({ form: f, date: dates[i] ?? '', doc: docs[i] ?? '', acc: acc[i] ?? '' }))
          .filter((x) => x.form === '4' && x.date >= cutoff)
          .slice(0, limit)
          .map((x) => {
            const accFmt = (x.acc as string).replace(/-/g, '');
            return { period: x.date, accession: x.acc, filing_url: `https://www.sec.gov/Archives/edgar/data/${cikShort}/${accFmt}/${x.doc as string}`, index_url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cikShort}&type=4&dateb=&owner=include&count=10` };
          });
      }
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'sec.gov/EDGAR', ticker, cik: cikShort, window: { start_date: start, end_date: end, days }, form_type: '4', total_in_window: trades.length, trades, note: 'Each trade object includes a filing_url to the actual Form 4 XML/HTML for full insider buy/sell details (shares, price, transaction code).', _disclaimer: 'SEC EDGAR public filing data. Not investment advice.', _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'edgar_fetch_failed', message: String(err) }); }
  });

  // ── /x402/drug-adverse-events — openFDA FAERS, keyless, $0.08 ───────────────
  app.get('/x402/drug-adverse-events', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/drug-adverse-events`;
    const drug = cleanTerm(typeof req.query['drug'] === 'string' ? req.query['drug'] : '');
    const limit = Math.min(Math.max(parseInt(String(req.query['limit'] ?? '10'), 10) || 10, 1), 25);
    const inputSchema = { type: 'object', properties: { drug: { type: 'string', description: 'Drug name (required).' }, limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 } }, required: ['drug'] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { drug: { type: 'string', required: true }, limit: { type: 'integer', required: false } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 80000n, description: 'FDA adverse event reports (openFDA FAERS): reactions, seriousness, outcomes for a drug. Pay 0.08 USDC on Base via X-PAYMENT (standard) or X-PAYMENT-TX (sovereign).', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!drug) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_drug', detail: 'Payment verified. Add ?drug= and retry with the same payment.' }); }
    try {
      const fdaKey = byokKey(req, 'x-openfda-key', 'OPENFDA_API_KEY');
      const p = new URLSearchParams({ search: `patient.drug.medicinalproduct:"${drug}"`, limit: String(limit), sort: 'receivedate:desc' });
      if (fdaKey) p.set('api_key', fdaKey);
      const r = await fetch(`https://api.fda.gov/drug/event.json?${p.toString()}`);
      if (r.status === 404) return res.set('Access-Control-Allow-Origin', '*').json({ source: 'openfda/drug/event', drug, count: 0, events: [], _disclaimer: 'FDA FAERS reference data. Not medical advice.', _paid: pay.payer });
      if (!r.ok) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'openfda_error', status: r.status }); }
      const j = await r.json() as { meta?: { results?: { total?: number } }; results?: Array<Record<string, unknown>> };
      const events = (j.results ?? []).map((e) => {
        const pt = e['patient'] as Record<string, unknown> | undefined ?? {};
        const reactions = ((pt['reaction'] ?? []) as Array<Record<string, unknown>>).map((rx) => String(rx['reactionmeddrapt'] ?? '')).filter(Boolean).slice(0, 8);
        const drugs = ((pt['drug'] ?? []) as Array<Record<string, unknown>>).map((d2) => String(d2['medicinalproduct'] ?? '')).filter(Boolean).slice(0, 5);
        const src = (e['primarysource'] as Record<string, unknown> | undefined) ?? {};
        return { report_id: String(e['safetyreportid'] ?? ''), received: String(e['receivedate'] ?? ''), serious: e['serious'] === '1' || e['serious'] === 1, reactions, concomitant_drugs: drugs, reporter_country: String(src['reportercountry'] ?? ''), outcome: String(((pt['patientdeath'] as Record<string, unknown>)?.['patientdeathdate']) ? 'death' : (e['seriousnesshospitalization'] === '1' ? 'hospitalization' : (e['seriousnesslifethreatening'] === '1' ? 'life_threatening' : 'other'))) };
      });
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'openfda/drug/event', drug, total: j.meta?.results?.total ?? events.length, count: events.length, events, _disclaimer: 'FDA FAERS reference data. Not medical advice.', _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'openfda_fetch_failed', message: String(err) }); }
  });

  // ── /x402/sec-8k — SEC EDGAR 8-K material events by ticker, $0.25 ────────────
  app.get('/x402/sec-8k', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/sec-8k`;
    const ticker = cleanTerm(typeof req.query['ticker'] === 'string' ? req.query['ticker'] : '').toUpperCase();
    const limit = Math.min(Math.max(parseInt(String(req.query['limit'] ?? '5'), 10) || 5, 1), 20);
    const inputSchema = { type: 'object', properties: { ticker: { type: 'string', description: 'Stock ticker (required). e.g. TSLA, AMC, GME.' }, limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 } }, required: ['ticker'] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { ticker: { type: 'string', required: true }, limit: { type: 'integer', required: false } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 250000n, description: 'SEC EDGAR 8-K material event filings by ticker (earnings surprises, CEO changes, M&A). Pay 0.25 USDC on Base via X-PAYMENT (standard) or X-PAYMENT-TX (sovereign).', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!ticker || !/^[A-Z]{1,5}$/.test(ticker)) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_or_invalid_ticker', detail: 'Payment verified. Add ?ticker=TSLA and retry with the same payment.' }); }
    try {
      const cik = await resolveTickerToCik(ticker);
      if (!cik) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(404).set('Access-Control-Allow-Origin', '*').json({ error: 'ticker_not_found', ticker }); }
      const r = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: { 'User-Agent': 'ScriptMasterLabs ScriptMasterLabs@gmail.com' } });
      if (!r.ok) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'edgar_error', status: r.status }); }
      const sub = await r.json() as { name?: string; filings?: { recent?: { form?: string[]; filingDate?: string[]; primaryDocument?: string[]; accessionNumber?: string[]; items?: string[] } } };
      const rec = sub.filings?.recent ?? {};
      const forms = rec.form ?? []; const dates = rec.filingDate ?? []; const docs = rec.primaryDocument ?? []; const acc = rec.accessionNumber ?? []; const items = rec.items ?? [];
      const cikShort = cik.replace(/^0+/, '');
      const filings = forms.map((f, i) => ({ form: f, date: dates[i] ?? '', doc: docs[i] ?? '', acc: acc[i] ?? '', items: String(items[i] ?? '') }))
        .filter((x) => x.form === '8-K')
        .slice(0, limit)
        .map((x) => {
          const accFmt = x.acc.replace(/-/g, '');
          return { date: x.date, form: x.form, items: x.items, filing_url: `https://www.sec.gov/Archives/edgar/data/${cikShort}/${accFmt}/${x.doc}`, accession: x.acc };
        });
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'sec.gov/EDGAR', ticker, company: sub.name ?? '', cik: cikShort, form_type: '8-K', count: filings.length, filings, note: 'Items field indicates the material event type (e.g. 2.02=earnings, 5.02=executive change, 1.01=agreement). filing_url links to the full 8-K document.', _disclaimer: 'SEC EDGAR public filing data. Not investment advice.', _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'edgar_fetch_failed', message: String(err) }); }
  });

  // ── /x402/treasury-yields — Daily Treasury yield curve, keyless, $0.05 ───────
  app.get('/x402/treasury-yields', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/treasury-yields`;
    const month = typeof req.query['month'] === 'string' && /^\d{6}$/.test(req.query['month']) ? req.query['month'] : new Date().toISOString().slice(0, 7).replace('-', '');
    const inputSchema = { type: 'object', properties: { month: { type: 'string', description: 'YYYYMM format (optional, defaults to current month). e.g. 202606.' } }, required: [] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { month: { type: 'string', required: false } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 50000n, description: 'Daily US Treasury yield curve rates (1M–30Y). Pay 0.05 USDC on Base via X-PAYMENT (standard) or X-PAYMENT-TX (sovereign).', inputSchema, outputSchema });
    if (!pay.ok) return;
    try {
      const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=${month}`;
      const r = await fetch(url, { headers: { Accept: 'application/xml' } });
      if (!r.ok) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'treasury_error', status: r.status }); }
      const xml = await r.text();
      const pick = (tag: string): string | null => { const m = xml.match(new RegExp(`<d:${tag}[^>]*>([^<]+)</d:${tag}>`)); return m ? (m[1] ?? null) : null; };
      const pickAll = (tag: string): string[] => { const re = new RegExp(`<d:${tag}[^>]*>([^<]+)<\/d:${tag}>`, 'g'); const out: string[] = []; let m; while ((m = re.exec(xml)) !== null) { if (m[1]) out.push(m[1]); } return out; };
      const dates = pickAll('NEW_DATE'); const m1 = pickAll('BC_1MONTH'); const m3 = pickAll('BC_3MONTH'); const m6 = pickAll('BC_6MONTH'); const y1 = pickAll('BC_1YEAR'); const y2 = pickAll('BC_2YEAR'); const y3 = pickAll('BC_3YEAR'); const y5 = pickAll('BC_5YEAR'); const y7 = pickAll('BC_7YEAR'); const y10 = pickAll('BC_10YEAR'); const y20 = pickAll('BC_20YEAR'); const y30 = pickAll('BC_30YEAR');
      const datesFallback = pickAll('Id').map((id) => { const dm = id.match(/(\d{4}-\d{2}-\d{2})/); return dm ? (dm[1] ?? '') : ''; }).filter(Boolean);
      const useDates = dates.length > 0 ? dates : datesFallback;
      const curve = m1.map((_v, i) => ({ date: useDates[i] ?? `${month.slice(0,4)}-${month.slice(4,6)}`, '1M': m1[i] ?? null, '3M': m3[i] ?? null, '6M': m6[i] ?? null, '1Y': y1[i] ?? null, '2Y': y2[i] ?? null, '3Y': y3[i] ?? null, '5Y': y5[i] ?? null, '7Y': y7[i] ?? null, '10Y': y10[i] ?? null, '20Y': y20[i] ?? null, '30Y': y30[i] ?? null })).slice(0, 5).reverse();
      const latest = curve[curve.length - 1] ?? {};
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'home.treasury.gov/yield-curve', month, latest, recent_days: curve, units: 'percent', _disclaimer: 'US Treasury published yield curve rates. Not investment advice.', _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'treasury_fetch_failed', message: String(err) }); }
  });

  // ── /x402/entity-compliance — SAM registration + exclusion + size standard ($0.35) ─
  app.get('/x402/entity-compliance', async (req, res) => {
    const samKey = byokKey(req, 'x-sam-key', 'SAM_API_KEY');
    if (!samKey) return res.status(503).set('Access-Control-Allow-Origin', '*').json({ error: 'service_unconfigured', detail: 'SAM_API_KEY required. No payment taken.' });
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/entity-compliance`;
    const uei = cleanTerm(typeof req.query['uei'] === 'string' ? req.query['uei'] : '').toUpperCase().replace(/\s/g, '');
    const cage = cleanTerm(typeof req.query['cage'] === 'string' ? req.query['cage'] : '').toUpperCase().replace(/\s/g, '');
    const inputSchema = { type: 'object', properties: { uei: { type: 'string', description: 'SAM.gov UEI (12-char alphanumeric). Preferred.' }, cage: { type: 'string', description: 'CAGE code (5-char). Alternative to UEI.' } }, required: [] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { uei: { type: 'string', required: false }, cage: { type: 'string', required: false } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 350000n, description: 'Entity compliance bundle: SAM registration status + expiry + exclusion flag + set-aside types + size standard. Pay 0.35 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!uei && !cage) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_identifier', detail: 'Payment verified. Add ?uei= or ?cage= and retry with the same payment.' }); }
    try {
      const p = new URLSearchParams({ api_key: samKey, includeSections: 'entityRegistration,coreData,assertions', registrationStatus: 'A,E,I' });
      if (uei) p.set('ueiSAM', uei);
      else if (cage) p.set('cageCode', cage);
      const r = await fetch(`https://api.sam.gov/entity-information/v3/entities?${p.toString()}`, { headers: { Accept: 'application/json' } });
      if (!r.ok) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'sam_api_error', status: r.status }); }
      const j = await r.json() as { totalRecords?: number; entityData?: Array<Record<string, unknown>> };
      if (!j.entityData?.length) { return res.set('Access-Control-Allow-Origin', '*').json({ source: 'sam.gov/entity-information/v3', found: false, uei, cage, compliance: null, _paid: pay.payer }); }
      const e = j.entityData[0] as Record<string, unknown>;
      const er = (e['entityRegistration'] as Record<string, unknown>) ?? {};
      const cd = (e['coreData'] as Record<string, unknown>) ?? {};
      const assertions = (e['assertions'] as Record<string, unknown>) ?? {};
      const bt = (cd['businessTypes'] as Record<string, unknown>) ?? {};
      const btList = ((bt['businessTypeList'] as Array<Record<string, unknown>>) ?? []).map((x) => String(x['businessTypeCode'] ?? ''));
      const setAsides = ((bt['sbaBusinessTypeList'] as Array<Record<string, unknown>>) ?? []).map((x) => ({ code: String(x['sbaBusinessTypeCode'] ?? ''), name: String(x['sbaBusinessTypeDesc'] ?? ''), cert_url: String(x['certificationEntryDate'] ?? '') }));
      const goods = (assertions['goodsAndServices'] as Record<string, unknown>) ?? {};
      const naics = ((goods['naicsCode'] as Array<Record<string, unknown>>) ?? []).slice(0, 5).map((n) => ({ code: String(n['naicsCode'] ?? ''), description: String(n['naicsDescription'] ?? ''), primary: Boolean(n['isPrimary']) }));
      const active = String(er['registrationStatus'] ?? '') === 'A';
      const expiry = String(er['registrationExpirationDate'] ?? '');
      const daysLeft = expiry ? Math.floor((new Date(expiry).getTime() - Date.now()) / 86400000) : null;
      const exclusion = String(er['exclusionStatusFlag'] ?? 'N') === 'Y';
      const compliance: Record<string, unknown> = {
        uei: String(er['ueiSAM'] ?? uei), cage: String(er['cageCode'] ?? cage),
        legal_name: String(er['legalBusinessName'] ?? ''),
        registration_status: active ? 'ACTIVE' : String(er['registrationStatus'] ?? ''),
        registration_expires: expiry, days_until_expiry: daysLeft,
        exclusion_flag: exclusion, exclusion_risk: exclusion ? 'HIGH — entity is excluded from federal contracts' : 'CLEAR',
        purpose_of_registration: String(er['purposeOfRegistrationCode'] ?? ''),
        business_type_codes: btList,
        set_asides: setAsides,
        primary_naics: naics.find((n) => n.primary)?.code ?? naics[0]?.code ?? '',
        naics_codes: naics,
        expiry_risk: daysLeft !== null && daysLeft < 90 ? `WARNING: registration expires in ${daysLeft} days` : 'OK',
      };
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'sam.gov/entity-information/v3', found: true, compliance, _disclaimer: 'SAM.gov registration data. Exclusion flag is self-reported in SAM. Always verify at sam.gov for contract decisions.', _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'sam_fetch_failed', message: String(err) }); }
  });

  // ── /x402/agent-score — AI agent FICO-style reputation scoring ($0.20) ────────
  // Scores an agent by agent_id across: task_success_rate, payment_reliability,
  // error_rate, data_freshness_requests, uptime_score. Stores in-memory registry.
  // Real behavioral signals submitted by operator; score 300-850 (FICO-style).
  const AGENT_REGISTRY = new Map<string, { scores: number[]; payments: number; errors: number; tasks: number; last_seen: number; created: number }>();
  const scoreAgent = (data: { tasks?: number; successes?: number; payments?: number; errors?: number; uptime?: number }): number => {
    const taskRate = data.tasks ? (data.successes ?? data.tasks) / data.tasks : 1;
    const errorRate = data.tasks ? Math.min((data.errors ?? 0) / data.tasks, 1) : 0;
    const payRate = data.payments ? Math.min(data.payments / 100, 1) : 0.5;
    const uptime = Math.min(Math.max(data.uptime ?? 0.99, 0), 1);
    const raw = (taskRate * 0.35 + (1 - errorRate) * 0.30 + payRate * 0.20 + uptime * 0.15);
    return Math.round(300 + raw * 550);
  };
  const scoreGrade = (s: number): string => s >= 800 ? 'A+' : s >= 750 ? 'A' : s >= 700 ? 'B+' : s >= 650 ? 'B' : s >= 600 ? 'C' : s >= 500 ? 'D' : 'F';
  app.get('/x402/agent-score', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/agent-score`;
    const agentId = cleanTerm(typeof req.query['agent_id'] === 'string' ? req.query['agent_id'] : '').slice(0, 64);
    const action = typeof req.query['action'] === 'string' ? req.query['action'] : 'get';
    const tasks = parseInt(String(req.query['tasks'] ?? '0'), 10) || 0;
    const successes = parseInt(String(req.query['successes'] ?? '0'), 10) || 0;
    const errors = parseInt(String(req.query['errors'] ?? '0'), 10) || 0;
    const payments = parseInt(String(req.query['payments'] ?? '0'), 10) || 0;
    const uptime = parseFloat(String(req.query['uptime'] ?? '0.99')) || 0.99;
    const inputSchema = { type: 'object', properties: { agent_id: { type: 'string', description: 'Unique agent identifier (required).' }, action: { type: 'string', enum: ['get', 'report'], default: 'get', description: 'get=retrieve score; report=submit behavioral data to update score.' }, tasks: { type: 'integer', description: 'Total tasks attempted (for action=report).' }, successes: { type: 'integer' }, errors: { type: 'integer' }, payments: { type: 'integer', description: 'Successful micropayments made.' }, uptime: { type: 'number', minimum: 0, maximum: 1 } }, required: ['agent_id'] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { agent_id: { type: 'string', required: true }, action: { type: 'string', required: false } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 200000n, description: 'AI agent FICO-style reputation score (300-850). Submit behavioral signals or retrieve score. Pay 0.20 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!agentId) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_agent_id', detail: 'Payment verified. Add ?agent_id= and retry with the same payment.' }); }
    const now = Date.now();
    if (action === 'report' && tasks > 0) {
      const existing = AGENT_REGISTRY.get(agentId) ?? { scores: [], payments: 0, errors: 0, tasks: 0, last_seen: now, created: now };
      existing.tasks += tasks; existing.errors += errors; existing.payments += payments; existing.last_seen = now;
      const score = scoreAgent({ tasks: existing.tasks, successes: successes || tasks - errors, errors: existing.errors, payments: existing.payments, uptime });
      existing.scores.push(score);
      if (existing.scores.length > 50) existing.scores.shift();
      AGENT_REGISTRY.set(agentId, existing);
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'sml/agent-credit-bureau', agent_id: agentId, action: 'report', score, grade: scoreGrade(score), trend: existing.scores.length > 1 ? (score > (existing.scores[existing.scores.length - 2] ?? score) ? 'improving' : 'declining') : 'new', history_count: existing.scores.length, _paid: pay.payer });
    }
    const rec = AGENT_REGISTRY.get(agentId);
    if (!rec) return res.set('Access-Control-Allow-Origin', '*').json({ source: 'sml/agent-credit-bureau', agent_id: agentId, found: false, score: null, detail: 'No behavioral data on file. Submit action=report with task signals to establish score.', _paid: pay.payer });
    const score = rec.scores[rec.scores.length - 1] ?? 300;
    return res.set('Access-Control-Allow-Origin', '*').json({ source: 'sml/agent-credit-bureau', agent_id: agentId, found: true, score, grade: scoreGrade(score), range: '300 (critical) — 850 (exceptional)', breakdown: { tasks_logged: rec.tasks, errors_logged: rec.errors, payments_logged: rec.payments, days_active: Math.floor((now - rec.created) / 86400000) }, trend: rec.scores.length > 1 ? (score > (rec.scores[rec.scores.length - 2] ?? score) ? 'improving' : 'declining') : 'stable', _paid: pay.payer });
  });

  // ── /x402/fact-check — grounding oracle against live SML data sources ($0.15) ─
  // Accepts a claim + optional domain, routes to the relevant real API, and returns
  // the primary source evidence that confirms, contradicts, or is inconclusive.
  type FactDomain = 'grants' | 'contracts' | 'drug' | 'provider' | 'insider' | 'yields' | 'clinical' | 'general';
  const detectDomain = (claim: string): FactDomain => {
    const c = claim.toLowerCase();
    if (/grant|cfda|opportunity|funding/.test(c)) return 'grants';
    if (/contract|award|naics|incumbent|bid/.test(c)) return 'contracts';
    if (/drug|medication|recall|adverse|fda|label/.test(c)) return 'drug';
    if (/provider|npi|physician|doctor|hospital|clinic/.test(c)) return 'provider';
    if (/insider|form 4|executive|ceo|cfo|buy|sell|stock/.test(c)) return 'insider';
    if (/yield|treasury|interest rate|bond|10.year|30.year/.test(c)) return 'yields';
    if (/trial|clinical|recruiting|nct|phase/.test(c)) return 'clinical';
    return 'general';
  };
  app.get('/x402/fact-check', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/fact-check`;
    const claim = (typeof req.query['claim'] === 'string' ? req.query['claim'] : '').slice(0, 300);
    const domainHint = typeof req.query['domain'] === 'string' ? req.query['domain'] as FactDomain : undefined;
    const inputSchema = { type: 'object', properties: { claim: { type: 'string', description: 'The claim or statement to fact-check (required, max 300 chars).' }, domain: { type: 'string', enum: ['grants', 'contracts', 'drug', 'provider', 'insider', 'yields', 'clinical', 'general'], description: 'Hint to route to the correct data source (optional — auto-detected).' } }, required: ['claim'] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { claim: { type: 'string', required: true }, domain: { type: 'string', required: false } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 150000n, description: 'Grounding oracle: fact-checks a claim against live government/FDA/SEC/Treasury data. Pay 0.15 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!claim) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_claim', detail: 'Payment verified. Add ?claim= and retry with the same payment.' }); }
    const domain = domainHint ?? detectDomain(claim);
    let evidence: unknown = null; let source_url = ''; let verdict = 'inconclusive';
    try {
      if (domain === 'yields') {
        const month = new Date().toISOString().slice(0, 7).replace('-', '');
        const r = await fetch(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=${month}`);
        const xml = await r.text();
        const pick = (tag: string): string | null => { const m = xml.match(new RegExp(`<d:${tag}[^>]*>([^<]+)<\/d:${tag}>`)); return m ? (m[1] ?? null) : null; };
        evidence = { '1M': pick('BC_1MONTH'), '3M': pick('BC_3MONTH'), '10Y': pick('BC_10YEAR'), '30Y': pick('BC_30YEAR') };
        source_url = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/';
        verdict = evidence ? 'grounded' : 'inconclusive';
      } else if (domain === 'drug') {
        const term = cleanTerm(claim.replace(/recall|drug|fda|label|adverse/gi, '').trim()).slice(0, 40);
        const r = await fetch(`https://api.fda.gov/drug/label.json?search=openfda.brand_name:"${term}" OR openfda.generic_name:"${term}"&limit=1`);
        if (r.ok) { const j = await r.json() as { results?: unknown[] }; evidence = j.results?.length ? 'Drug label found in openFDA' : 'No matching drug found'; verdict = j.results?.length ? 'grounded' : 'unverified'; }
        source_url = 'https://api.fda.gov/drug/label.json';
      } else if (domain === 'clinical') {
        const term = cleanTerm(claim.replace(/clinical trial|recruiting|phase|nct/gi, '').trim()).slice(0, 40);
        const r = await fetch(`https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(term)}&pageSize=2`, { headers: { Accept: 'application/json' } });
        if (r.ok) { const j = await r.json() as { totalCount?: number }; evidence = { trials_found: j.totalCount ?? 0 }; verdict = (j.totalCount ?? 0) > 0 ? 'grounded' : 'unverified'; }
        source_url = 'https://clinicaltrials.gov/api/v2/studies';
      } else if (domain === 'grants') {
        const term = cleanTerm(claim.replace(/grant|funding|cfda/gi, '').trim()).slice(0, 40);
        const r = await fetch('https://api.grants.gov/v1/api/search2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: term, rows: 3 }) });
        if (r.ok) { const j = await r.json() as { data?: { hitCount?: number } }; evidence = { grants_found: j.data?.hitCount ?? 0 }; verdict = (j.data?.hitCount ?? 0) > 0 ? 'grounded' : 'unverified'; }
        source_url = 'https://api.grants.gov/v1/api/search2';
      } else if (domain === 'contracts') {
        const r = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_category/recipient/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filters: { award_type_codes: ['A', 'B', 'C', 'D'], time_period: [{ start_date: '2024-01-01', end_date: new Date().toISOString().slice(0, 10) }] }, category: 'recipient', limit: 3, page: 1 }) });
        if (r.ok) { const j = await r.json() as { results?: unknown[] }; evidence = { top_recipients: j.results }; verdict = 'grounded'; }
        source_url = 'https://api.usaspending.gov/api/v2';
      } else {
        evidence = { note: 'Domain auto-detected as general. Provide ?domain= hint for targeted grounding.' };
        verdict = 'inconclusive';
        source_url = 'https://mcp-x402.onrender.com/openapi.json';
      }
      return res.set('Access-Control-Allow-Origin', '*').json({ source: source_url, claim, domain, verdict, evidence, verdict_key: { grounded: 'Primary source evidence found supporting the domain.', unverified: 'No primary source evidence found — claim may be inaccurate.', inconclusive: 'Domain unclear or source returned no usable data.' }[verdict], _disclaimer: 'Fact-check results are based on public government/FDA/SEC data. Not legal, medical, or financial advice.', _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'factcheck_error', message: String(err) }); }
  });

  // ── /x402/sec-13f — SEC EDGAR 13F institutional holdings ──────────────────
  app.get('/x402/sec-13f', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/sec-13f`;
    const cik = (typeof req.query['cik'] === 'string' ? req.query['cik'] : '').replace(/\D/g, '').padStart(10, '0');
    const name = (typeof req.query['name'] === 'string' ? req.query['name'] : '').trim();
    const inputSchema = { type: 'object', properties: { cik: { type: 'string', description: '10-digit SEC CIK number.' }, name: { type: 'string', description: 'Institution or fund name (e.g. "Berkshire Hathaway").' } } };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { cik: { type: 'string', required: false }, name: { type: 'string', required: false } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 250000n, description: 'SEC EDGAR 13F institutional holdings — hedge fund quarterly positions. Pay 0.25 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!cik && !name) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_param', detail: 'Payment verified. Add ?cik= (10-digit CIK) or ?name= (institution name) and retry.' }); }
    try {
      let resolvedCik = cik;
      if (!resolvedCik && name) {
        const searchR = await fetch(`https://efts.sec.gov/LATEST/search-index?q="${encodeURIComponent(name)}"&dateRange=custom&startdt=2024-01-01&forms=13F-HR`, { headers: { 'User-Agent': 'ScriptMasterLabs contact@scriptmasterlabs.com' } });
        if (searchR.ok) {
          // EDGAR full-text search returns ciks as an array on _source (see the
          // identical shape consumed by /x402/sec-13dg below) — there is no
          // entity_id field. Reading entity_id always returned undefined, so
          // every name-based 13F lookup failed with institution_not_found
          // regardless of whether EDGAR actually found a match.
          const searchJ = await searchR.json() as { hits?: { hits?: { _source?: { ciks?: string[] } }[] } };
          resolvedCik = (searchJ.hits?.hits?.[0]?._source?.ciks?.[0] ?? '').padStart(10, '0');
        }
      }
      if (!resolvedCik || resolvedCik === '0000000000') { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(404).set('Access-Control-Allow-Origin', '*').json({ error: 'institution_not_found', detail: 'Could not resolve institution to a CIK. Try supplying the 10-digit CIK directly.' }); }
      const subR = await fetch(`https://data.sec.gov/submissions/CIK${resolvedCik}.json`, { headers: { 'User-Agent': 'ScriptMasterLabs contact@scriptmasterlabs.com' } });
      if (!subR.ok) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(404).set('Access-Control-Allow-Origin', '*').json({ error: 'cik_not_found', detail: `CIK ${resolvedCik} not found in EDGAR.` }); }
      const sub = await subR.json() as { name?: string; filings?: { recent?: { accessionNumber?: string[]; form?: string[]; filingDate?: string[]; primaryDocument?: string[] } } };
      const forms = sub.filings?.recent?.form ?? [];
      const accessions = sub.filings?.recent?.accessionNumber ?? [];
      const dates = sub.filings?.recent?.filingDate ?? [];
      const docs = sub.filings?.recent?.primaryDocument ?? [];
      const holdings: { accession: string; filingDate: string; document: string; url: string }[] = [];
      for (let i = 0; i < forms.length && holdings.length < 5; i++) {
        if (forms[i] === '13F-HR') {
          const acc = (accessions[i] ?? '').replace(/-/g, '');
          holdings.push({ accession: accessions[i] ?? '', filingDate: dates[i] ?? '', document: docs[i] ?? '', url: `https://www.sec.gov/Archives/edgar/data/${parseInt(resolvedCik, 10)}/${acc}/${docs[i] ?? ''}` });
        }
      }
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'SEC EDGAR 13F-HR', institution: sub.name ?? name, cik: resolvedCik, filings_returned: holdings.length, filings: holdings, note: 'Each filing URL links to the XML/HTML 13F information table with all reported holdings.', _disclaimer: 'SEC EDGAR public data. Not investment advice.', _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'edgar_13f_error', message: String(err) }); }
  });

  // ── /x402/lobbying — Senate LDA lobbying disclosure search ────────────────
  app.get('/x402/lobbying', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/lobbying`;
    const client = (typeof req.query['client'] === 'string' ? req.query['client'] : '').trim();
    const registrant = (typeof req.query['registrant'] === 'string' ? req.query['registrant'] : '').trim();
    const issue = (typeof req.query['issue'] === 'string' ? req.query['issue'] : '').trim();
    const limit = Math.min(25, Math.max(1, parseInt(typeof req.query['limit'] === 'string' ? req.query['limit'] : '10', 10) || 10));
    const inputSchema = { type: 'object', properties: { client: { type: 'string', description: 'Client/organization being lobbied for.' }, registrant: { type: 'string', description: 'Lobbying firm name.' }, issue: { type: 'string', description: 'LDA issue area code (e.g. TAX, HCR, DEF).' }, limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 } } };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { client: { type: 'string', required: false }, registrant: { type: 'string', required: false }, issue: { type: 'string', required: false } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 150000n, description: 'Senate LDA lobbying disclosures — client, registrant, issues, and amounts. Pay 0.15 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!client && !registrant && !issue) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_param', detail: 'Payment verified. Add ?client=, ?registrant=, or ?issue= and retry.' }); }
    try {
      const params = new URLSearchParams({ page_size: String(limit), ordering: '-dt_posted' });
      if (client) params.set('client_name', client);
      if (registrant) params.set('registrant_name', registrant);
      if (issue) params.set('issue_code', issue);
      const r = await fetch(`https://lda.senate.gov/api/v1/filings/?${params.toString()}`, { headers: { Accept: 'application/json' } });
      if (!r.ok) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'lda_api_error', status: r.status }); }
      const j = await r.json() as { count?: number; results?: unknown[] };
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'Senate LDA API v1', total_filings: j.count ?? 0, returned: (j.results ?? []).length, filings: j.results ?? [], _disclaimer: 'Senate Lobbying Disclosure Act public data. Data is self-reported by registrants.', _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'lobbying_error', message: String(err) }); }
  });

  // ── /x402/patents — USPTO PatentsView patent search ───────────────────────
  app.get('/x402/patents', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/patents`;
    const query = (typeof req.query['query'] === 'string' ? req.query['query'] : '').trim();
    const assignee = (typeof req.query['assignee'] === 'string' ? req.query['assignee'] : '').trim();
    const limit = Math.min(25, Math.max(1, parseInt(typeof req.query['limit'] === 'string' ? req.query['limit'] : '10', 10) || 10));
    const inputSchema = { type: 'object', properties: { query: { type: 'string', description: 'Keyword or phrase to search in patent titles.' }, assignee: { type: 'string', description: 'Assignee organization name.' }, limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 } } };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { query: { type: 'string', required: false }, assignee: { type: 'string', required: false } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 100000n, description: 'USPTO PatentsView patent search — title, abstract, assignee, CPC class, grant date. Pay 0.10 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!query && !assignee) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_param', detail: 'Payment verified. Add ?query= (keyword/title) or ?assignee= (company name) and retry.' }); }
    try {
      const body: Record<string, unknown> = { _fields: ['patent_id', 'patent_title', 'patent_abstract', 'patent_date', 'patent_num_claims', 'assignee_organization', 'cpc_group_id'], _per_page: limit };
      if (query && assignee) { body.q = { _and: [{ _text_phrase: { patent_title: query } }, { assignee_organization: assignee }] }; }
      else if (query) { body.q = { _text_phrase: { patent_title: query } }; }
      else { body.q = { assignee_organization: assignee }; }
      const r = await fetch('https://api.patentsview.org/patents/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'patentsview_error', status: r.status }); }
      const j = await r.json() as { patents?: unknown[]; total_patent_count?: number };
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'USPTO PatentsView API', total_found: j.total_patent_count ?? 0, returned: (j.patents ?? []).length, patents: j.patents ?? [], _disclaimer: 'USPTO PatentsView public data. Patent grant does not guarantee validity or enforceability.', _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'patents_error', message: String(err) }); }
  });

  // ── /x402/fred — FRED economic indicator series ───────────────────────────
  app.get('/x402/fred', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/fred`;
    const series_id = (typeof req.query['series_id'] === 'string' ? req.query['series_id'] : '').trim().toUpperCase();
    const limit = Math.min(50, Math.max(1, parseInt(typeof req.query['limit'] === 'string' ? req.query['limit'] : '20', 10) || 20));
    const fredKey = byokKey(req, 'x-fred-key', 'FRED_API_KEY');
    const inputSchema = { type: 'object', properties: { series_id: { type: 'string', description: 'FRED series ID (e.g. GDP, CPIAUCSL, UNRATE, FEDFUNDS).' }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 } }, required: ['series_id'] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { series_id: { type: 'string', required: true }, limit: { type: 'integer', required: false } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 80000n, description: 'FRED economic indicator data — GDP, CPI, unemployment, rates, and 800k+ series from the Federal Reserve. Pay 0.08 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!fredKey) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(503).set('Access-Control-Allow-Origin', '*').json({ error: 'upstream_not_configured', detail: 'FRED_API_KEY not configured on this server.' }); }
    if (!series_id) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_param', detail: 'Payment verified. Add ?series_id= (e.g. GDP, CPIAUCSL, UNRATE, FEDFUNDS) and retry.' }); }
    try {
      const infoR = await fetch(`https://api.stlouisfed.org/fred/series?series_id=${encodeURIComponent(series_id)}&api_key=${fredKey}&file_type=json`);
      const obsR = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(series_id)}&api_key=${fredKey}&file_type=json&sort_order=desc&limit=${limit}`);
      if (!infoR.ok || !obsR.ok) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'fred_api_error', status: infoR.status }); }
      const info = await infoR.json() as { seriess?: { id: string; title: string; units: string; frequency: string; seasonal_adjustment: string; last_updated: string }[] };
      const obs = await obsR.json() as { observations?: { date: string; value: string }[] };
      const meta = info.seriess?.[0];
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'FRED / Federal Reserve Bank of St. Louis', series_id, title: meta?.title ?? '', units: meta?.units ?? '', frequency: meta?.frequency ?? '', seasonal_adjustment: meta?.seasonal_adjustment ?? '', last_updated: meta?.last_updated ?? '', observations_returned: (obs.observations ?? []).length, observations: obs.observations ?? [], _disclaimer: 'Federal Reserve Economic Data (FRED). Economic indicators are subject to revision.', _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'fred_error', message: String(err) }); }
  });

  // ── /x402/osha — OSHA inspection and violation records ────────────────────
  app.get('/x402/osha', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/osha`;
    const establishment = (typeof req.query['establishment'] === 'string' ? req.query['establishment'] : '').trim();
    const naics = (typeof req.query['naics'] === 'string' ? req.query['naics'] : '').trim();
    const state = (typeof req.query['state'] === 'string' ? req.query['state'].toUpperCase() : '').trim();
    const limit = Math.min(25, Math.max(1, parseInt(typeof req.query['limit'] === 'string' ? req.query['limit'] : '10', 10) || 10));
    const inputSchema = { type: 'object', properties: { establishment: { type: 'string', description: 'Establishment or employer name.' }, naics: { type: 'string', description: '6-digit NAICS industry code.' }, state: { type: 'string', description: '2-letter U.S. state code.' }, limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 } } };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { establishment: { type: 'string', required: false }, naics: { type: 'string', required: false }, state: { type: 'string', required: false } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 100000n, description: 'OSHA workplace inspection and violation records — citations, penalties, activity type, inspection date. Pay 0.10 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!establishment && !naics && !state) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_param', detail: 'Payment verified. Add ?establishment=, ?naics=, or ?state= and retry.' }); }
    try {
      const params = new URLSearchParams({ format: 'json', limit: String(limit) });
      if (establishment) params.set('establishment_name', establishment);
      if (naics) params.set('naics_code', naics);
      if (state) params.set('site_state', state);
      const r = await fetch(`https://data.dol.gov/get/osha_inspection?${params.toString()}`, { headers: { Accept: 'application/json' } });
      if (!r.ok) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'osha_api_error', status: r.status }); }
      const j = await r.json() as unknown[];
      const inspections = Array.isArray(j) ? j : [];
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'DOL / OSHA Enforcement Data', returned: inspections.length, inspections, _disclaimer: 'U.S. Department of Labor OSHA public enforcement data. Violations are administrative findings, not criminal convictions.', _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'osha_error', message: String(err) }); }
  });

  // ── /x402/fda-510k — FDA 510(k) medical device clearances ─────────────────
  app.get('/x402/fda-510k', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/fda-510k`;
    const device = (typeof req.query['device'] === 'string' ? req.query['device'] : '').trim();
    const applicant = (typeof req.query['applicant'] === 'string' ? req.query['applicant'] : '').trim();
    const limit = Math.min(25, Math.max(1, parseInt(typeof req.query['limit'] === 'string' ? req.query['limit'] : '10', 10) || 10));
    const inputSchema = { type: 'object', properties: { device: { type: 'string', description: 'Device name or type (e.g. "pulse oximeter").' }, applicant: { type: 'string', description: 'Manufacturer or applicant company name.' }, limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 } } };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { device: { type: 'string', required: false }, applicant: { type: 'string', required: false } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 80000n, description: 'FDA 510(k) medical device premarket clearances — device name, applicant, decision date, product code, clearance status. Pay 0.08 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!device && !applicant) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_param', detail: 'Payment verified. Add ?device= (device name/type) or ?applicant= (company name) and retry.' }); }
    try {
      const parts: string[] = [];
      if (device) parts.push(`device_name:"${device.replace(/"/g, '')}"`);
      if (applicant) parts.push(`applicant:"${applicant.replace(/"/g, '')}"`);
      const search = parts.join(' AND ');
      const p = new URLSearchParams({ search, limit: String(limit), sort: 'decision_date:desc' });
      const r = await fetch(`https://api.fda.gov/device/510k.json?${p.toString()}`);
      if (r.status === 404) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(404).set('Access-Control-Allow-Origin', '*').json({ error: 'no_results', detail: 'No 510(k) clearances found for that device or applicant.' }); }
      if (!r.ok) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'fda_api_error', status: r.status }); }
      const j = await r.json() as { meta?: { results?: { total?: number } }; results?: { k_number?: string; device_name?: string; applicant?: string; decision_date?: string; decision_description?: string; product_code?: string; statement_or_summary?: string }[] };
      const total = j.meta?.results?.total ?? 0;
      const clearances = (j.results ?? []).map(c => ({ k_number: c.k_number, device_name: c.device_name, applicant: c.applicant, decision_date: c.decision_date, decision: c.decision_description, product_code: c.product_code, summary_url: c.statement_or_summary ? `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm?ID=${c.k_number}` : undefined }));
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'openFDA device/510k', total_found: total, returned: clearances.length, clearances, _disclaimer: '510(k) clearance means FDA found substantial equivalence to a predicate device — it does not mean FDA approval of safety/effectiveness.', _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'fda_510k_error', message: String(err) }); }
  });

  // ── /x402/sec-10k — SEC EDGAR 10-K annual report filings by ticker ($0.20) ──────
  app.get('/x402/sec-10k', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/sec-10k`;
    const ticker = cleanTerm(typeof req.query['ticker'] === 'string' ? req.query['ticker'] : '').toUpperCase();
    const limit = Math.min(Math.max(parseInt(String(req.query['limit'] ?? '5'), 10) || 5, 1), 10);
    const inputSchema = { type: 'object', properties: { ticker: { type: 'string', description: 'Stock ticker (required). e.g. AAPL, TSLA.' }, limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 } }, required: ['ticker'] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { ticker: { type: 'string', required: true } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 200000n, description: 'SEC EDGAR 10-K annual report filings by ticker. Links to full 10-K documents. Pay 0.20 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!ticker || !/^[A-Z]{1,5}$/.test(ticker)) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_or_invalid_ticker', detail: 'Payment verified. Add ?ticker=AAPL and retry.' }); }
    try {
      const cik = await resolveTickerToCik(ticker);
      if (!cik) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(404).set('Access-Control-Allow-Origin', '*').json({ error: 'ticker_not_found', ticker }); }
      const r = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: { 'User-Agent': 'ScriptMasterLabs ScriptMasterLabs@gmail.com' } });
      if (!r.ok) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'edgar_error', status: r.status }); }
      const sub = await r.json() as { name?: string; filings?: { recent?: { form?: string[]; filingDate?: string[]; primaryDocument?: string[]; accessionNumber?: string[] } } };
      const rec = sub.filings?.recent ?? {}; const forms = rec.form ?? []; const dates = rec.filingDate ?? []; const docs = rec.primaryDocument ?? []; const acc = rec.accessionNumber ?? [];
      const cikShort = cik.replace(/^0+/, '');
      const filings = forms.map((f, i) => ({ form: f, date: dates[i] ?? '', doc: docs[i] ?? '', acc: acc[i] ?? '' })).filter(x => x.form === '10-K').slice(0, limit).map(x => { const accFmt = x.acc.replace(/-/g, ''); return { date: x.date, form: x.form, accession: x.acc, filing_url: `https://www.sec.gov/Archives/edgar/data/${cikShort}/${accFmt}/${x.doc}`, index_url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cikShort}&type=10-K&dateb=&owner=include&count=5` }; });
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'sec.gov/EDGAR', ticker, company: sub.name ?? '', cik: cikShort, form_type: '10-K', count: filings.length, filings, note: 'Each filing_url links to the full 10-K annual report HTML/XBRL document.', _disclaimer: 'SEC EDGAR public filing data. Not investment advice.', _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'edgar_fetch_failed', message: String(err) }); }
  });

  // ── /x402/sec-10q — SEC EDGAR 10-Q quarterly filings by ticker ($0.15) ─────────
  app.get('/x402/sec-10q', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/sec-10q`;
    const ticker = cleanTerm(typeof req.query['ticker'] === 'string' ? req.query['ticker'] : '').toUpperCase();
    const limit = Math.min(Math.max(parseInt(String(req.query['limit'] ?? '5'), 10) || 5, 1), 10);
    const inputSchema = { type: 'object', properties: { ticker: { type: 'string', description: 'Stock ticker (required).' }, limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 } }, required: ['ticker'] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { ticker: { type: 'string', required: true } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 150000n, description: 'SEC EDGAR 10-Q quarterly report filings by ticker. Links to full 10-Q documents. Pay 0.15 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!ticker || !/^[A-Z]{1,5}$/.test(ticker)) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_or_invalid_ticker', detail: 'Payment verified. Add ?ticker=AAPL and retry.' }); }
    try {
      const cik = await resolveTickerToCik(ticker);
      if (!cik) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(404).set('Access-Control-Allow-Origin', '*').json({ error: 'ticker_not_found', ticker }); }
      const r = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: { 'User-Agent': 'ScriptMasterLabs ScriptMasterLabs@gmail.com' } });
      if (!r.ok) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'edgar_error', status: r.status }); }
      const sub = await r.json() as { name?: string; filings?: { recent?: { form?: string[]; filingDate?: string[]; primaryDocument?: string[]; accessionNumber?: string[] } } };
      const rec = sub.filings?.recent ?? {}; const forms = rec.form ?? []; const dates = rec.filingDate ?? []; const docs = rec.primaryDocument ?? []; const acc = rec.accessionNumber ?? [];
      const cikShort = cik.replace(/^0+/, '');
      const filings = forms.map((f, i) => ({ form: f, date: dates[i] ?? '', doc: docs[i] ?? '', acc: acc[i] ?? '' })).filter(x => x.form === '10-Q').slice(0, limit).map(x => { const accFmt = x.acc.replace(/-/g, ''); return { date: x.date, form: x.form, accession: x.acc, filing_url: `https://www.sec.gov/Archives/edgar/data/${cikShort}/${accFmt}/${x.doc}` }; });
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'sec.gov/EDGAR', ticker, company: sub.name ?? '', cik: cikShort, form_type: '10-Q', count: filings.length, filings, _disclaimer: 'SEC EDGAR public filing data. Not investment advice.', _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'edgar_fetch_failed', message: String(err) }); }
  });

  // ── /x402/sec-13dg — SEC EDGAR 13D/13G activist investor filings ($0.20) ────────
  app.get('/x402/sec-13dg', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/sec-13dg`;
    const ticker = cleanTerm(typeof req.query['ticker'] === 'string' ? req.query['ticker'] : '').toUpperCase();
    const limit = Math.min(Math.max(parseInt(String(req.query['limit'] ?? '10'), 10) || 10, 1), 20);
    const inputSchema = { type: 'object', properties: { ticker: { type: 'string', description: 'Stock ticker (required). e.g. TSLA, GME.' }, limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 } }, required: ['ticker'] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { ticker: { type: 'string', required: true } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 200000n, description: 'SEC EDGAR 13D and 13G activist investor filings by ticker — who holds 5%+ stakes. Pay 0.20 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!ticker || !/^[A-Z]{1,5}$/.test(ticker)) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_or_invalid_ticker', detail: 'Payment verified. Add ?ticker=TSLA and retry.' }); }
    try {
      const cik = await resolveTickerToCik(ticker);
      if (!cik) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(404).set('Access-Control-Allow-Origin', '*').json({ error: 'ticker_not_found', ticker }); }
      // Previously called efts.sec.gov/LATEST/search-index with only forms+
      // dateRange and no `q` — EDGAR's full-text search requires a query term
      // to function at all, so every call was rejected (edgar_search_error).
      // Switched to the same submissions-API + client-side form filter that
      // /x402/sec-10k and /x402/sec-10q already use successfully — no search
      // API, no missing required param.
      const r = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: { 'User-Agent': 'ScriptMasterLabs ScriptMasterLabs@gmail.com' } });
      if (!r.ok) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'edgar_error', status: r.status }); }
      const sub = await r.json() as { filings?: { recent?: { form?: string[]; filingDate?: string[]; primaryDocument?: string[]; accessionNumber?: string[] } } };
      const rec = sub.filings?.recent ?? {}; const forms = rec.form ?? []; const dates = rec.filingDate ?? []; const docs = rec.primaryDocument ?? []; const acc = rec.accessionNumber ?? [];
      const cikShort = cik.replace(/^0+/, '');
      const filings = forms
        .map((f, i) => ({ form: f, date: dates[i] ?? '', doc: docs[i] ?? '', acc: acc[i] ?? '' }))
        .filter(x => x.form === 'SC 13D' || x.form === 'SC 13G')
        .slice(0, limit)
        .map(x => { const accFmt = x.acc.replace(/-/g, ''); return { accession: x.acc, form: x.form, filed: x.date, url: `https://www.sec.gov/Archives/edgar/data/${cikShort}/${accFmt}/${x.doc}` }; });
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'sec.gov/EDGAR', ticker, cik: cikShort, forms: ['SC 13D', 'SC 13G'], count: filings.length, filings, note: '13D=activist stake (intent to influence). 13G=passive 5%+ holder.', _disclaimer: 'SEC EDGAR public filing data. Not investment advice.', _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'edgar_fetch_failed', message: String(err) }); }
  });

  // ── /x402/finra-broker — FINRA BrokerCheck ($0.15) ───────────────────────────────
  app.get('/x402/finra-broker', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/finra-broker`;
    const name = (typeof req.query['name'] === 'string' ? req.query['name'] : '').trim().slice(0, 80);
    const type = typeof req.query['type'] === 'string' && req.query['type'] === 'firm' ? 'firm' : 'individual';
    const inputSchema = { type: 'object', properties: { name: { type: 'string', description: 'Broker, advisor, or firm name (required).' }, type: { type: 'string', enum: ['individual', 'firm'], default: 'individual', description: 'Search individual brokers or firms.' } }, required: ['name'] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { name: { type: 'string', required: true }, type: { type: 'string', required: false } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 150000n, description: 'FINRA BrokerCheck broker/advisor registration status and disclosure history. Pay 0.15 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!name) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_name', detail: 'Payment verified. Add ?name= and retry.' }); }
    try {
      const p = new URLSearchParams({ query: name, hl: 'true', includePrevious: 'true', nrows: '10', wt: 'json' });
      const r = await fetch(`https://api.brokercheck.finra.org/search/${type}?${p.toString()}`, { headers: { Accept: 'application/json', 'User-Agent': 'ScriptMasterLabs ScriptMasterLabs@gmail.com' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'finra_api_error', status: r.status }); }
      const j = await r.json() as { hits?: { total?: number; hits?: Array<{ _source?: Record<string, unknown> }> } };
      const total = j.hits?.total ?? 0;
      const results = (j.hits?.hits ?? []).map(h => {
        const s = h._source ?? {};
        return { name: String(s['ind_firstname'] ?? s['biz_nm'] ?? ''), last_name: String(s['ind_lastname'] ?? ''), firm: String(s['ind_empl_nm'] ?? ''), crd: String(s['ind_source_id'] ?? s['biz_source_id'] ?? ''), disclosures: Number(s['ind_disc_ev_disclosure_cnt'] ?? s['biz_disc_ev_disclosure_cnt'] ?? 0), registrations: Number(s['ind_regn_cnt'] ?? 0), status: String(s['ind_regn_active'] === 'Y' ? 'ACTIVE' : 'INACTIVE'), url: s['ind_source_id'] ? `https://brokercheck.finra.org/individual/summary/${s['ind_source_id']}` : (s['biz_source_id'] ? `https://brokercheck.finra.org/firm/summary/${s['biz_source_id']}` : '') };
      });
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'FINRA BrokerCheck', query: { name, type }, total_found: total, returned: results.length, results, _disclaimer: 'FINRA BrokerCheck public data. Disclosures include regulatory actions, customer disputes, and criminal/civil matters.', _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'finra_fetch_failed', message: String(err) }); }
  });

  // ── /x402/fec-finance — FEC campaign finance contributions ($0.10) ─────────────
  app.get('/x402/fec-finance', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/fec-finance`;
    const name = (typeof req.query['name'] === 'string' ? req.query['name'] : '').trim();
    const committee = (typeof req.query['committee'] === 'string' ? req.query['committee'] : '').trim();
    const cycle = typeof req.query['cycle'] === 'string' && /^\d{4}$/.test(req.query['cycle']) ? req.query['cycle'] : String(new Date().getFullYear() % 2 === 0 ? new Date().getFullYear() : new Date().getFullYear() - 1);
    const fecKey = byokKey(req, 'x-fec-key', 'FEC_API_KEY', 'DEMO_KEY');
    const inputSchema = { type: 'object', properties: { name: { type: 'string', description: 'Candidate or contributor name.' }, committee: { type: 'string', description: 'Committee name or ID.' }, cycle: { type: 'string', description: 'Election cycle year (e.g. 2024). Defaults to latest.' } } };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { name: { type: 'string', required: false }, committee: { type: 'string', required: false } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 100000n, description: 'FEC campaign finance — candidates, committees, and contribution totals. Pay 0.10 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!name && !committee) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_param', detail: 'Payment verified. Add ?name= (candidate name) or ?committee= and retry.' }); }
    try {
      const p = new URLSearchParams({ api_key: fecKey ?? 'DEMO_KEY', per_page: '10', sort: '-receipts', cycle });
      if (name) p.set('q', name);
      if (committee) p.set('q', committee);
      const endpoint = committee ? 'committees' : 'candidates';
      const r = await fetch(`https://api.open.fec.gov/v1/${endpoint}/?${p.toString()}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (r.status === 429) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(429).set('Access-Control-Allow-Origin', '*').json({ error: 'fec_rate_limited', detail: 'FEC DEMO_KEY rate limit hit. Server operator may set FEC_API_KEY (free at api.data.gov).', _paid: pay.payer }); }
      if (!r.ok) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'fec_api_error', status: r.status }); }
      const j = await r.json() as { pagination?: { count?: number }; results?: Array<Record<string, unknown>> };
      const results = (j.results ?? []).map(x => ({ name: String(x['name'] ?? x['candidate_name'] ?? ''), id: String(x['candidate_id'] ?? x['committee_id'] ?? ''), party: String(x['party_full'] ?? ''), office: String(x['office_full'] ?? ''), state: String(x['state'] ?? ''), cycle: x['election_years'] ?? [], receipts: x['receipts'] ?? x['total_receipts'] ?? 0, disbursements: x['disbursements'] ?? x['total_disbursements'] ?? 0 }));
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'FEC Open Data (api.open.fec.gov)', cycle, query: { name: name || null, committee: committee || null }, total_found: j.pagination?.count ?? results.length, returned: results.length, results, _disclaimer: 'Federal Election Commission public data. Campaign finance figures are self-reported filings.', _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'fec_fetch_failed', message: String(err) }); }
  });

  // ── /x402/epa-violations — EPA ECHO enforcement and violation records ($0.12) ──
  app.get('/x402/epa-violations', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/epa-violations`;
    const facility = (typeof req.query['facility'] === 'string' ? req.query['facility'] : '').trim().slice(0, 80);
    const state = (typeof req.query['state'] === 'string' ? req.query['state'].toUpperCase() : '').trim().slice(0, 2);
    const naics = (typeof req.query['naics'] === 'string' ? req.query['naics'] : '').trim().slice(0, 8);
    const inputSchema = { type: 'object', properties: { facility: { type: 'string', description: 'Facility or company name.' }, state: { type: 'string', description: '2-letter U.S. state code.' }, naics: { type: 'string', description: 'NAICS code filter.' } } };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { facility: { type: 'string', required: false }, state: { type: 'string', required: false } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 120000n, description: 'EPA ECHO enforcement and environmental violation records — facility inspections, penalties, and compliance status. Pay 0.12 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!facility && !state && !naics) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_param', detail: 'Payment verified. Add ?facility=, ?state=, or ?naics= and retry.' }); }
    try {
      const p = new URLSearchParams({ output: 'JSON', p_rows: '20' });
      if (facility) p.set('p_fn', facility);
      if (state) p.set('p_st', state);
      if (naics) p.set('p_naics', naics);
      const r = await fetch(`https://ofmpub.epa.gov/echo/echo_rest_services.get_facilities?${p.toString()}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) {
        if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx);
        return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'epa_api_error', status: r.status });
      }
      const j = await r.json() as { Results?: { Message?: string; BadSystemIDs?: string; Facilities?: Array<Record<string, unknown>> } };
      const facilities = j.Results?.Facilities ?? [];
      const results = facilities.slice(0, 15).map(f => ({
        name: String(f['FacName'] ?? ''), id: String(f['RegistryID'] ?? ''), address: [f['Street'], f['City'], f['State'], f['Zip']].filter(Boolean).join(', '), naics_code: String(f['NAICSCodes'] ?? ''), violations: Number(f['EPASystem'] ?? 0), inspections: Number(f['InspCount'] ?? 0), penalties: Number(f['PenaltyCount'] ?? 0), last_inspection: String(f['LastInspDT'] ?? ''), compliance_status: String(f['CompStatus'] ?? ''), programs: String(f['ActivePrograms'] ?? ''),
      }));
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'EPA ECHO (echo.epa.gov)', query: { facility: facility || null, state: state || null, naics: naics || null }, returned: results.length, facilities: results, _disclaimer: 'EPA ECHO public enforcement data. Violations are regulatory findings under Clean Air/Water/RCRA/TSCA programs.', _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'epa_fetch_failed', message: String(err) }); }
  });

  // ── /x402/sbir-grants — SBIR/STTR small business innovation grants ($0.05) ─────
  app.get('/x402/sbir-grants', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/sbir-grants`;
    const keyword = (typeof req.query['keyword'] === 'string' ? req.query['keyword'] : '').trim().slice(0, 150);
    const agency = (typeof req.query['agency'] === 'string' ? req.query['agency'] : '').trim().toUpperCase().slice(0, 10);
    const phase = typeof req.query['phase'] === 'string' && ['1', '2'].includes(req.query['phase']) ? req.query['phase'] : '';
    const limit = Math.min(Math.max(parseInt(String(req.query['limit'] ?? '10'), 10) || 10, 1), 25);
    const inputSchema = { type: 'object', properties: { keyword: { type: 'string', description: 'Technology keywords (required).' }, agency: { type: 'string', description: 'Federal agency abbreviation (e.g. DOD, NIH, NASA, NSF, DOE).' }, phase: { type: 'string', enum: ['1', '2'], description: 'SBIR/STTR phase (1=feasibility, 2=development).' }, limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 } }, required: ['keyword'] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { keyword: { type: 'string', required: true }, agency: { type: 'string', required: false } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 50000n, description: 'SBIR/STTR small business innovation research grants. Search by keyword, agency (DOD, NIH, NASA, NSF). Pay 0.05 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!keyword) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_keyword', detail: 'Payment verified. Add ?keyword= and retry.' }); }
    try {
      const p = new URLSearchParams({ q: keyword, rows: String(limit), sort: 'AwardDate desc' });
      if (agency) p.set('agency', agency);
      if (phase) p.set('phase', phase);
      const r = await fetch(`https://api.sbir.gov/public/api/projects?${p.toString()}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'sbir_api_error', status: r.status }); }
      const j = await r.json() as { response?: { numFound?: number; docs?: Array<Record<string, unknown>> } };
      const docs = j.response?.docs ?? [];
      const grants = docs.map(d => ({ title: String(d['project_title'] ?? ''), company: String(d['firm'] ?? ''), agency: String(d['agency'] ?? ''), branch: String(d['branch'] ?? ''), phase: String(d['phase'] ?? ''), award_year: String(d['award_year'] ?? ''), award_amount: Number(d['award_amount'] ?? 0), abstract: (String(d['abstract'] ?? '')).slice(0, 400), solicitation: String(d['solicitation_number'] ?? ''), topic: String(d['topic_code'] ?? '') }));
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'SBIR.gov / SBA', query: { keyword, agency: agency || 'all', phase: phase || 'all' }, total_found: j.response?.numFound ?? grants.length, returned: grants.length, grants, _disclaimer: 'SBIR/STTR public award data from SBA. Amounts reflect total project award value.', _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'sbir_fetch_failed', message: String(err) }); }
  });

  // ── /x402/congress-bills — Congress.gov bill search ($0.08) ──────────────────────
  app.get('/x402/congress-bills', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/congress-bills`;
    const query = (typeof req.query['query'] === 'string' ? req.query['query'] : '').trim().slice(0, 150);
    const congress = typeof req.query['congress'] === 'string' && /^\d{3}$/.test(req.query['congress']) ? req.query['congress'] : '119';
    const status = typeof req.query['status'] === 'string' ? req.query['status'] : '';
    const limit = Math.min(Math.max(parseInt(String(req.query['limit'] ?? '10'), 10) || 10, 1), 20);
    const congressKey = byokKey(req, 'x-congress-key', 'CONGRESS_API_KEY');
    const inputSchema = { type: 'object', properties: { query: { type: 'string', description: 'Bill keyword search (required).' }, congress: { type: 'string', description: 'Congress number (e.g. 119 for 119th Congress, 2025-2026). Default: 119.' }, limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 } }, required: ['query'] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { query: { type: 'string', required: true } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 80000n, description: 'Congress.gov bill search — legislation by keyword, congress number, and status. Pay 0.08 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!congressKey) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(503).set('Access-Control-Allow-Origin', '*').json({ error: 'service_unconfigured', detail: 'CONGRESS_API_KEY not configured. Free key at api.congress.gov. No payment taken.' }); }
    if (!query) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_query', detail: 'Payment verified. Add ?query= and retry.' }); }
    try {
      const p = new URLSearchParams({ query, limit: String(limit), format: 'json', api_key: congressKey });
      if (status) p.set('status', status);
      const r = await fetch(`https://api.congress.gov/v3/bill/${congress}?${p.toString()}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'congress_api_error', status: r.status }); }
      const j = await r.json() as { bills?: Array<Record<string, unknown>>; pagination?: { count?: number } };
      const bills = (j.bills ?? []).map(b => ({ number: String(b['number'] ?? ''), type: String(b['type'] ?? ''), title: String(b['title'] ?? ''), congress: String(b['congress'] ?? congress), introduced_date: String(b['introducedDate'] ?? ''), latest_action: (b['latestAction'] as Record<string, unknown> | undefined)?.['text'] ?? '', sponsor: ((b['sponsors'] as Array<Record<string, unknown>> | undefined)?.[0])?.['fullName'] ?? '', url: String((b['url'] ?? '')) }));
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'Congress.gov API v3', congress: `${congress}th`, query: { search: query, status: status || 'all' }, total_found: j.pagination?.count ?? bills.length, returned: bills.length, bills, _disclaimer: 'Congress.gov public legislative data. Bill status is from official congressional records.', _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'congress_fetch_failed', message: String(err) }); }
  });

  // ── /x402/fda-warnings — FDA warning letters (openFDA) ($0.10) ───────────────────
  app.get('/x402/fda-warnings', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/fda-warnings`;
    const company = cleanTerm(typeof req.query['company'] === 'string' ? req.query['company'] : '');
    const product = cleanTerm(typeof req.query['product'] === 'string' ? req.query['product'] : '');
    const limit = Math.min(Math.max(parseInt(String(req.query['limit'] ?? '10'), 10) || 10, 1), 25);
    const inputSchema = { type: 'object', properties: { company: { type: 'string', description: 'Company or issuer name.' }, product: { type: 'string', description: 'Product, drug, or device name.' }, limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 } } };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { company: { type: 'string', required: false }, product: { type: 'string', required: false } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 100000n, description: 'FDA warning letters — regulatory enforcement letters for violations of FDA regulations. Pay 0.10 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!company && !product) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_param', detail: 'Payment verified. Add ?company= or ?product= and retry.' }); }
    try {
      const parts: string[] = [];
      if (company) parts.push(`company_name:"${company}"`);
      if (product) parts.push(`product_type:"${product}" OR subject:"${product}"`);
      const search = parts.join(' AND ');
      const fdaKey = byokKey(req, 'x-openfda-key', 'OPENFDA_API_KEY');
      const p = new URLSearchParams({ search, limit: String(limit), sort: 'date_issued:desc' });
      if (fdaKey) p.set('api_key', fdaKey);
      const r = await fetch(`https://api.fda.gov/other/warning_letters.json?${p.toString()}`, { signal: AbortSignal.timeout(15000) });
      if (r.status === 404) return res.set('Access-Control-Allow-Origin', '*').json({ source: 'openFDA/other/warning_letters', count: 0, letters: [], _disclaimer: 'FDA warning letter reference data.', _paid: pay.payer });
      if (!r.ok) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'openfda_error', status: r.status }); }
      const j = await r.json() as { meta?: { results?: { total?: number } }; results?: Array<Record<string, unknown>> };
      const letters = (j.results ?? []).map(x => ({ company: String(x['company_name'] ?? ''), subject: String(x['subject'] ?? ''), issued: String(x['date_issued'] ?? ''), posted: String(x['date_posted'] ?? ''), product_type: String(x['product_type'] ?? ''), issuing_office: String(x['issuing_office'] ?? ''), response_url: String(x['related_documents'] ?? '') }));
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'openFDA/other/warning_letters', total: j.meta?.results?.total ?? letters.length, count: letters.length, letters, _disclaimer: 'FDA warning letters are regulatory enforcement actions — not criminal charges. Full letters at fda.gov.', _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'fda_warnings_fetch_failed', message: String(err) }); }
  });

  // ── /x402/cms-providers — CMS Medicare hospital and provider quality data ($0.10) ─
  app.get('/x402/cms-providers', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/cms-providers`;
    const name = (typeof req.query['name'] === 'string' ? req.query['name'] : '').trim().slice(0, 80);
    const state = (typeof req.query['state'] === 'string' ? req.query['state'].toUpperCase() : '').trim().slice(0, 2);
    const type = typeof req.query['type'] === 'string' && req.query['type'] === 'physician' ? 'physician' : 'hospital';
    const limit = Math.min(Math.max(parseInt(String(req.query['limit'] ?? '10'), 10) || 10, 1), 20);
    const inputSchema = { type: 'object', properties: { name: { type: 'string', description: 'Hospital or provider name.' }, state: { type: 'string', description: '2-letter state code.' }, type: { type: 'string', enum: ['hospital', 'physician'], default: 'hospital' }, limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 } } };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { name: { type: 'string', required: false }, state: { type: 'string', required: false } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 100000n, description: 'CMS Medicare hospital quality data and physician provider information. Pay 0.10 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!name && !state) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_param', detail: 'Payment verified. Add ?name= or ?state= and retry.' }); }
    try {
      let r: globalThis.Response; let j: { meta?: Record<string, unknown>; data?: Array<Record<string, unknown>> };
      if (type === 'hospital') {
        const p = new URLSearchParams({ '$limit': String(limit) });
        if (name) p.set('$q', name);
        if (state) p.set('state', state);
        r = await fetch(`https://data.cms.gov/data-api/v1/dataset/xubh-q36u/data?${p.toString()}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
        if (!r.ok) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'cms_api_error', status: r.status }); }
        const arr = await r.json() as Array<Record<string, unknown>>;
        const providers = arr.slice(0, limit).map(x => ({ name: String(x['HOSP_NAME'] ?? x['hospital_name'] ?? ''), address: String(x['ADDRESS'] ?? ''), city: String(x['CITY'] ?? ''), state: String(x['STATE'] ?? ''), zip: String(x['ZIP_CODE'] ?? ''), phone: String(x['PHONE_NUMBER'] ?? ''), type: String(x['HOSPITAL_TYPE'] ?? ''), ownership: String(x['HOSPITAL_OWNERSHIP'] ?? ''), emergency: String(x['EMERGENCY_SERVICES'] ?? ''), overall_rating: String(x['HOSPITAL_OVERALL_RATING'] ?? 'N/A'), mortality_national: String(x['MORTALITY_NATIONAL_COMPARISON'] ?? ''), readmission_national: String(x['READMISSION_NATIONAL_COMPARISON'] ?? '') }));
        return res.set('Access-Control-Allow-Origin', '*').json({ source: 'CMS Hospital General Information (data.cms.gov)', query: { name: name || null, state: state || null, type }, returned: providers.length, providers, _disclaimer: 'CMS Medicare quality data. Ratings are based on Medicare claims and quality measures.', _paid: pay.payer });
      } else {
        const p = new URLSearchParams({ '$limit': String(limit) });
        if (state) p.set('Rndrng_Prvdr_State_Abrvtn', state);
        if (name) p.set('$q', name);
        r = await fetch(`https://data.cms.gov/data-api/v1/dataset/9767f658-3c4f-4ac8-a71f-e7a93dab47c0/data?${p.toString()}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
        if (!r.ok) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'cms_api_error', status: r.status }); }
        const arr2 = await r.json() as Array<Record<string, unknown>>;
        const providers2 = arr2.slice(0, limit).map(x => ({ name: String(x['Rndrng_Prvdr_Last_Org_Name'] ?? ''), first_name: String(x['Rndrng_Prvdr_First_Name'] ?? ''), npi: String(x['Rndrng_NPI'] ?? ''), specialty: String(x['Rndrng_Prvdr_Type'] ?? ''), state: String(x['Rndrng_Prvdr_State_Abrvtn'] ?? ''), city: String(x['Rndrng_Prvdr_City'] ?? ''), services: Number(x['Tot_Srvcs'] ?? 0), beneficiaries: Number(x['Tot_Benes'] ?? 0), total_payment: Number(x['Tot_Mdcr_Pymt_Amt'] ?? 0) }));
        return res.set('Access-Control-Allow-Origin', '*').json({ source: 'CMS Medicare Part D Prescribers (data.cms.gov)', query: { name: name || null, state: state || null, type }, returned: providers2.length, providers: providers2, _disclaimer: 'CMS Medicare utilization data. Not a measure of physician quality or competence.', _paid: pay.payer });
      }
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'cms_fetch_failed', message: String(err) }); }
  });

  // ── /x402/nih-grants — NIH Reporter research grant database ($0.05) ─────────────
  app.get('/x402/nih-grants', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/nih-grants`;
    const query = (typeof req.query['query'] === 'string' ? req.query['query'] : '').trim().slice(0, 150);
    const agency = (typeof req.query['agency'] === 'string' ? req.query['agency'].toUpperCase() : '').trim().slice(0, 10);
    const fiscal_year = typeof req.query['fiscal_year'] === 'string' && /^\d{4}$/.test(req.query['fiscal_year']) ? parseInt(req.query['fiscal_year']) : new Date().getFullYear();
    const limit = Math.min(Math.max(parseInt(String(req.query['limit'] ?? '10'), 10) || 10, 1), 25);
    const inputSchema = { type: 'object', properties: { query: { type: 'string', description: 'Research topic keywords (required).' }, agency: { type: 'string', description: 'NIH institute abbreviation (e.g. NCI, NHLBI, NIAID, NINDS).' }, fiscal_year: { type: 'integer', description: 'Fiscal year filter (default: current year).' }, limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 } }, required: ['query'] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { query: { type: 'string', required: true }, agency: { type: 'string', required: false } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 50000n, description: 'NIH Reporter research grant database — active NIH grants by keyword and agency (NCI, NHLBI, NIAID, etc). Pay 0.05 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!query) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_query', detail: 'Payment verified. Add ?query= and retry.' }); }
    try {
      const body: Record<string, unknown> = { criteria: { use_relevance: true, include_active_projects: true, fiscal_years: [fiscal_year] }, limit, offset: 0, include_fields: ['ProjectTitle', 'AbstractText', 'FiscalYear', 'AwardAmount', 'PrincipalInvestigators', 'Organization', 'ProjectEndDate', 'AgencyIcAdmin', 'ActivityCode', 'OpportunityNumber'] };
      if (query) body.criteria = { ...(body.criteria as Record<string, unknown>), terms: [query] };
      if (agency) body.criteria = { ...(body.criteria as Record<string, unknown>), agencies: [{ abbreviation: agency }] };
      const r = await fetch('https://api.reporter.nih.gov/v2/projects/search', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      if (!r.ok) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'nih_api_error', status: r.status }); }
      const j = await r.json() as { total: number; results?: Array<Record<string, unknown>> };
      const grants = (j.results ?? []).map(g => {
        const pis = (g['principal_investigators'] as Array<Record<string, unknown>> | undefined ?? []).map(p => String(p['full_name'] ?? '')).filter(Boolean).join(', ');
        const org = (g['organization'] as Record<string, unknown> | undefined) ?? {};
        return { title: String(g['project_title'] ?? ''), abstract: (String(g['abstract_text'] ?? '')).slice(0, 400), pi: pis, organization: String(org['org_name'] ?? ''), state: String(org['org_state'] ?? ''), agency: String(g['agency_ic_admin'] ?? ''), activity_code: String(g['activity_code'] ?? ''), award_amount: Number(g['award_amount'] ?? 0), fiscal_year: Number(g['fiscal_year'] ?? fiscal_year), end_date: String(g['project_end_date'] ?? ''), opportunity: String(g['opportunity_number'] ?? '') };
      });
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'NIH Reporter API v2', query: { search: query, agency: agency || 'all', fiscal_year }, total_found: j.total, returned: grants.length, grants, _disclaimer: 'NIH Reporter public award data. Amounts reflect total cost including direct and indirect costs.', _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'nih_fetch_failed', message: String(err) }); }
  });

  // ── Equities/Options heatmap REST routes ────────────────────────────────────
  // Same self-contained EquitiesHeatmapAPI/OptionsDeltaHeatmapAPI used by the
  // MCP tool handlers (equities-heatmap.ts) — real Polygon.io data + real
  // RSI(14)/Black-Scholes Delta + real Claude swarm on the full tier. Exposed
  // here as plain REST/JSON so the browser dashboard at scriptmasterlabs.com
  // can call them directly with fetch(), no MCP client required.

  // BYOK: a caller's own market-data keys, sent as headers, always take
  // priority over this server's own env-configured keys — the operator never
  // pays another caller's Tradier/Polygon/Alpaca bill.
  const byokFromHeaders = (req: Request): DataCredentials => ({
    tradierApiKey: typeof req.headers['x-tradier-key'] === 'string' ? req.headers['x-tradier-key'] : undefined,
    polygonApiKey: typeof req.headers['x-polygon-key'] === 'string' ? req.headers['x-polygon-key'] : undefined,
    alpacaApiKey: typeof req.headers['x-alpaca-key'] === 'string' ? req.headers['x-alpaca-key'] : undefined,
    alpacaApiSecret: typeof req.headers['x-alpaca-secret'] === 'string' ? req.headers['x-alpaca-secret'] : undefined,
  });

  app.get('/x402/equities-heatmap/preview', async (req, res) => {
    try {
      const data = await EquitiesHeatmapAPI.preview(byokFromHeaders(req));
      return res.set('Access-Control-Allow-Origin', '*').json(data);
    } catch (err) {
      return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'api_error', message: String(err) });
    }
  });

  const EQUITIES_HEATMAP_PRICE_UNITS = 100000n; // 0.10 USDC
  app.get('/x402/equities-heatmap', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/equities-heatmap`;
    const tickers = typeof req.query['tickers'] === 'string'
      ? req.query['tickers'].split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20)
      : undefined;
    const timeframe = req.query['timeframe'] === '1d' ? '1d' as const : req.query['timeframe'] === '1h' ? '1h' as const : undefined;
    const inputSchema = { type: 'object', properties: { tickers: { type: 'string', description: 'Comma-separated tickers, up to 20. Defaults to AMC/GME/IWM plus real dynamically-discovered top movers.' }, timeframe: { type: 'string', enum: ['1h', '1d'], default: '1h' } } };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { tickers: { type: 'string', required: false }, timeframe: { type: 'string', required: false } } }, output: null };

    const pay = await requirePayment(req, res, { resource, priceUnits: EQUITIES_HEATMAP_PRICE_UNITS, description: 'Equities RSI(14) heatmap (up to 20 tickers) with a real 4-agent Claude swarm verdict. Pay 0.10 USDC on Base via X-PAYMENT (standard) or X-PAYMENT-TX (sovereign).', inputSchema, outputSchema });
    if (!pay.ok) return;
    try {
      const data = await EquitiesHeatmapAPI.full(tickers, timeframe, byokFromHeaders(req));
      return res.set('Access-Control-Allow-Origin', '*').json({ data, _paid: pay.payer });
    } catch (err) {
      if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx);
      return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'api_error', message: String(err) });
    }
  });

  app.get('/x402/options-delta-heatmap/preview', async (req, res) => {
    const underlying = typeof req.query['underlying'] === 'string' ? req.query['underlying'] : undefined;
    try {
      const data = await OptionsDeltaHeatmapAPI.preview(underlying, byokFromHeaders(req));
      return res.set('Access-Control-Allow-Origin', '*').json(data);
    } catch (err) {
      return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'api_error', message: String(err) });
    }
  });

  const OPTIONS_HEATMAP_PRICE_UNITS = 150000n; // 0.15 USDC
  app.get('/x402/options-delta-heatmap', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/options-delta-heatmap`;
    const underlying = typeof req.query['underlying'] === 'string' ? req.query['underlying'] : undefined;
    const expirationDate = typeof req.query['expiration_date'] === 'string' ? req.query['expiration_date'] : undefined;
    const optionType = req.query['option_type'] === 'put' ? 'put' as const : req.query['option_type'] === 'call' ? 'call' as const : undefined;
    const inputSchema = { type: 'object', properties: { underlying: { type: 'string', description: 'Underlying ticker. Defaults to AMC.' }, expiration_date: { type: 'string', description: 'YYYY-MM-DD. Defaults to nearest available.' }, option_type: { type: 'string', enum: ['call', 'put'], default: 'call' } } };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { underlying: { type: 'string', required: false }, expiration_date: { type: 'string', required: false }, option_type: { type: 'string', required: false } } }, output: null };

    const pay = await requirePayment(req, res, { resource, priceUnits: OPTIONS_HEATMAP_PRICE_UNITS, description: 'Options Delta heatmap (up to 40 contracts) with a real 4-agent Claude swarm verdict. Pay 0.15 USDC on Base via X-PAYMENT (standard) or X-PAYMENT-TX (sovereign).', inputSchema, outputSchema });
    if (!pay.ok) return;
    try {
      const data = await OptionsDeltaHeatmapAPI.full(underlying, expirationDate, optionType, byokFromHeaders(req));
      return res.set('Access-Control-Allow-Origin', '*').json({ data, _paid: pay.payer });
    } catch (err) {
      if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx);
      return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'api_error', message: String(err) });
    }
  });

  // ── SqueezeOS-backed x402 routes ────────────────────────────────────────────
  // Each proxies through SqueezeOSAPI (X-API-Key operator bypass, not tied to
  // the caller's own payment) after this server's own requirePayment clears.

  app.get('/x402/ftd-threshold-list', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/ftd-threshold-list`;
    const inputSchema = { type: 'object', properties: {} };
    const outputSchema = { input: { type: 'http', method: 'GET' }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 20000n, description: 'Current SEC Reg SHO Threshold Securities List — persistent fails-to-deliver names. Pay 0.02 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    try {
      const result = await SqueezeOSAPI.ftdThresholdList();
      return res.set('Access-Control-Allow-Origin', '*').json({ ...(result as object), _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'upstream_error', message: String(err) }); }
  });

  app.get('/x402/ftd-time-series', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/ftd-time-series`;
    const symbol = (typeof req.query['symbol'] === 'string' ? req.query['symbol'] : '').toUpperCase().replace(/[^A-Z0-9.]/g, '').slice(0, 10);
    const limit = req.query['limit'] ? Math.min(Math.max(parseInt(String(req.query['limit']), 10) || 90, 1), 180) : undefined;
    const inputSchema = { type: 'object', properties: { symbol: { type: 'string', description: 'Equity ticker.' }, limit: { type: 'integer', minimum: 1, maximum: 180, default: 90 } }, required: ['symbol'] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { symbol: { type: 'string', required: true } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 20000n, description: 'Historical SEC Reg SHO fails-to-deliver time series for a symbol, up to 180 days. Pay 0.02 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!symbol) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_symbol', detail: 'Payment verified. Add ?symbol= and retry.' }); }
    try {
      const result = await SqueezeOSAPI.ftdTimeSeries(symbol, limit);
      return res.set('Access-Control-Allow-Origin', '*').json({ ...(result as object), _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'upstream_error', message: String(err) }); }
  });

  app.get('/x402/ftd-ratio', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/ftd-ratio`;
    const symbol = (typeof req.query['symbol'] === 'string' ? req.query['symbol'] : '').toUpperCase().replace(/[^A-Z0-9.]/g, '').slice(0, 10);
    const inputSchema = { type: 'object', properties: { symbol: { type: 'string', description: 'Equity ticker.' } }, required: ['symbol'] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { symbol: { type: 'string', required: true } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 30000n, description: 'Latest FTD record with percentile rank and threshold-list status for a symbol. Pay 0.03 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!symbol) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_symbol', detail: 'Payment verified. Add ?symbol= and retry.' }); }
    try {
      const result = await SqueezeOSAPI.ftdRatio(symbol);
      return res.set('Access-Control-Allow-Origin', '*').json({ ...(result as object), _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'upstream_error', message: String(err) }); }
  });

  app.get('/x402/ftd-etf-basket', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/ftd-etf-basket`;
    const etf = (typeof req.query['etf'] === 'string' ? req.query['etf'] : '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    const inputSchema = { type: 'object', properties: { etf: { type: 'string', description: 'ETF ticker (XRT, IWM, IJR, KRE).' } }, required: ['etf'] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { etf: { type: 'string', required: true } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 50000n, description: 'ETF constituents ranked by current FTD notional concentration (XRT, IWM, IJR, KRE). Pay 0.05 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!etf) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_etf', detail: 'Payment verified. Add ?etf= and retry.' }); }
    try {
      const result = await SqueezeOSAPI.ftdEtfBasket(etf);
      return res.set('Access-Control-Allow-Origin', '*').json({ ...(result as object), _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'upstream_error', message: String(err) }); }
  });

  app.get('/x402/ftd-settlement-cycle', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/ftd-settlement-cycle`;
    const symbol = (typeof req.query['symbol'] === 'string' ? req.query['symbol'] : '').toUpperCase().replace(/[^A-Z0-9.]/g, '').slice(0, 10);
    const inputSchema = { type: 'object', properties: { symbol: { type: 'string', description: 'Equity ticker.' } }, required: ['symbol'] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { symbol: { type: 'string', required: true } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 50000n, description: 'Settlement-cycle bundle: FTD stats, threshold-list status, T+21/T+35 markers, Reg SHO 204 13-day marker. Pay 0.05 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!symbol) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_symbol', detail: 'Payment verified. Add ?symbol= and retry.' }); }
    try {
      const result = await SqueezeOSAPI.ftdSettlementCycle(symbol);
      return res.set('Access-Control-Allow-Origin', '*').json({ ...(result as object), _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'upstream_error', message: String(err) }); }
  });

  app.get('/x402/options-flow', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/options-flow`;
    const inputSchema = { type: 'object', properties: { symbol: { type: 'string', description: 'Equity ticker (defaults to IWM).' } } };
    const outputSchema = { input: { type: 'http', method: 'GET' }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 50000n, description: 'Institutional options flow — sweeps, whale detection, unusual volume, dark-pool prints (Tradier brokerage-grade). Pay 0.05 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    try {
      const result = await SqueezeOSAPI.options(pay.payer.from);
      return res.set('Access-Control-Allow-Origin', '*').json({ ...(result as object), _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'upstream_error', message: String(err) }); }
  });

  app.post('/x402/cascade-signal', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/cascade-signal`;
    const symbol = (typeof req.body?.symbol === 'string' ? req.body.symbol : (typeof req.query['symbol'] === 'string' ? req.query['symbol'] : '')).toUpperCase().replace(/[^A-Z0-9.]/g, '').slice(0, 10);
    const inputSchema = { type: 'object', properties: { symbol: { type: 'string', description: 'Equity ticker.' } }, required: ['symbol'] };
    const outputSchema = { input: { type: 'http', method: 'POST', body: { symbol: { type: 'string', required: true } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 250000n, description: 'CASCADE ACCUMULATOR directive — ACCUMULATE/PYRAMID/EXIT/STOP mode for a symbol. Pay 0.25 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!symbol) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_symbol', detail: 'Payment verified. Add symbol and retry.' }); }
    try {
      const result = await SqueezeOSAPI.cascadeSignal(symbol);
      return res.set('Access-Control-Allow-Origin', '*').json({ ...(result as object), _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'upstream_error', message: String(err) }); }
  });

  app.get('/x402/iam-model', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/iam-model`;
    const symbol = (typeof req.query['symbol'] === 'string' ? req.query['symbol'] : '').toUpperCase().replace(/[^A-Z0-9.]/g, '').slice(0, 10);
    const inputSchema = { type: 'object', properties: { symbol: { type: 'string', description: 'Equity ticker.' } }, required: ['symbol'] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { symbol: { type: 'string', required: true } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 50000n, description: 'Inevitable Action Model — obligation committee verdict, Truth Layer state, and mandatory action for a symbol. Pay 0.05 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!symbol) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_symbol', detail: 'Payment verified. Add ?symbol= and retry.' }); }
    try {
      const result = await SqueezeOSAPI.iamResolve(symbol);
      return res.set('Access-Control-Allow-Origin', '*').json({ ...(result as object), _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'upstream_error', message: String(err) }); }
  });

  app.post('/x402/compliance-anomaly', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/compliance-anomaly`;
    const bank_id = typeof req.body?.bank_id === 'string' ? req.body.bank_id : '';
    const agent_id = typeof req.body?.agent_id === 'string' ? req.body.agent_id : '';
    const trigger = typeof req.body?.trigger === 'string' ? req.body.trigger : '';
    const detail = typeof req.body?.detail === 'string' ? req.body.detail : '';
    const severity = typeof req.body?.severity === 'string' ? req.body.severity : undefined;
    const inputSchema = { type: 'object', properties: { bank_id: { type: 'string' }, agent_id: { type: 'string' }, trigger: { type: 'string' }, detail: { type: 'string' }, severity: { type: 'string' } }, required: ['bank_id', 'agent_id', 'trigger', 'detail'] };
    const outputSchema = { input: { type: 'http', method: 'POST' }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 5000000n, description: 'Submit a bank compliance anomaly to the Leviathan Matrix swarm for scoring. Pay 5.00 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!bank_id || !agent_id || !trigger || !detail) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_fields', detail: 'Payment verified. Provide bank_id, agent_id, trigger, detail and retry.' }); }
    try {
      const result = await SqueezeOSAPI.complianceAnomalyReport({ bank_id, agent_id, trigger, detail, severity });
      return res.set('Access-Control-Allow-Origin', '*').json({ ...(result as object), _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'upstream_error', message: String(err) }); }
  });

  app.post('/x402/compliance-audit', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/compliance-audit`;
    const bank_id = typeof req.body?.bank_id === 'string' ? req.body.bank_id : (typeof req.query['bank_id'] === 'string' ? req.query['bank_id'] : '');
    const inputSchema = { type: 'object', properties: { bank_id: { type: 'string' } }, required: ['bank_id'] };
    const outputSchema = { input: { type: 'http', method: 'POST' }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 5000000n, description: 'Full Leviathan Matrix compliance audit cycle for a bank. Pay 5.00 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!bank_id) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_bank_id', detail: 'Payment verified. Provide bank_id and retry.' }); }
    try {
      const result = await SqueezeOSAPI.complianceBankAudit(bank_id);
      return res.set('Access-Control-Allow-Origin', '*').json({ ...(result as object), _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'upstream_error', message: String(err) }); }
  });

  app.get('/x402/compliance-regulator-query', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/compliance-regulator-query`;
    const bank_id = typeof req.query['bank_id'] === 'string' ? req.query['bank_id'] : '';
    const inputSchema = { type: 'object', properties: { bank_id: { type: 'string' } }, required: ['bank_id'] };
    const outputSchema = { input: { type: 'http', method: 'GET', queryParams: { bank_id: { type: 'string', required: true } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 2500000n, description: 'Real-time regulator compliance dashboard query for a bank. Pay 2.50 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!bank_id) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_bank_id', detail: 'Payment verified. Add ?bank_id= and retry.' }); }
    try {
      const result = await SqueezeOSAPI.complianceRegulatorQuery(bank_id);
      return res.set('Access-Control-Allow-Origin', '*').json({ ...(result as object), _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'upstream_error', message: String(err) }); }
  });

  app.post('/x402/max-conviction-signal', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/max-conviction-signal`;
    const symbol = (typeof req.body?.symbol === 'string' ? req.body.symbol : (typeof req.query['symbol'] === 'string' ? req.query['symbol'] : '')).toUpperCase().replace(/[^A-Z0-9.]/g, '').slice(0, 10);
    const inputSchema = { type: 'object', properties: { symbol: { type: 'string', description: 'Equity ticker.' } }, required: ['symbol'] };
    const outputSchema = { input: { type: 'http', method: 'POST', body: { symbol: { type: 'string', required: true } } }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 250000n, description: 'TRIPLE_LOCK_VERDICT — BULL or BEAR only when three independent engines (macro price stretch, dark-pool volume kinetics, ribbon harmonics) all agree; otherwise NO_TRIPLE_LOCK with the blocking engine named. Distinct from and rarer than a standard squeeze signal. Pay 0.25 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!symbol) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_symbol', detail: 'Payment verified. Provide symbol and retry.' }); }
    try {
      const result = await SqueezeOSAPI.maxConvictionSignal(symbol);
      return res.set('Access-Control-Allow-Origin', '*').json({ ...(result as object), _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'upstream_error', message: String(err) }); }
  });

  app.post('/x402/content-trust-score', async (req, res) => {
    const host = req.headers.host ?? 'mcp-x402.onrender.com';
    const resource = `https://${host}/x402/content-trust-score`;
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    const sender_wallet = typeof req.body?.sender_wallet === 'string' ? req.body.sender_wallet : undefined;
    const inputSchema = { type: 'object', properties: { content: { type: 'string' }, sender_wallet: { type: 'string' } }, required: ['content'] };
    const outputSchema = { input: { type: 'http', method: 'POST' }, output: null };
    const pay = await requirePayment(req, res, { resource, priceUnits: 10000n, description: 'Content misinformation trust scoring plus on-chain wallet trust ledger. Distinct mechanism from AI Fact Check (which cross-references live government data; this scores text content and sender wallet reputation). Pay 0.01 USDC on Base via X-PAYMENT or X-PAYMENT-TX.', inputSchema, outputSchema });
    if (!pay.ok) return;
    if (!content) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_content', detail: 'Payment verified. Provide content and retry.' }); }
    try {
      const result = await SqueezeOSAPI.contentWalletTrustScore(content, sender_wallet);
      return res.set('Access-Control-Allow-Origin', '*').json({ ...(result as object), _paid: pay.payer });
    } catch (err) { if (pay.payer.rail === 'sovereign') releaseRedeem(pay.payer.tx); return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'upstream_error', message: String(err) }); }
  });

  // ── x402 discovery document (OpenAPI 3.1 + x-service-info / x-payment-info) ─
  // x402scan's canonical signal; served at /.well-known/x402 and /openapi.json.
  const OPENAPI_DOC = {
    openapi: '3.1.0',
    info: { title: 'Script Master Labs — x402 Data API', version: VERSION, description: 'Pay-per-call U.S. federal data, settled in USDC on Base via x402.', contact: { name: 'Script Master Labs', email: 'ScriptMasterLabs@gmail.com', url: 'https://scriptmasterlabs.com' } },
    servers: [{ url: 'https://mcp-x402.onrender.com' }],
    'x-service-info': { categories: ['government-data', 'grants', 'federal-contracts', 'market-intelligence', 'medical-reference', 'drug-data', 'healthcare-providers', 'clinical-trials', 'sec-filings', 'insider-trading', 'finance', 'drug-safety', 'treasury', 'yield-curve', 'compliance', 'entity-verification', 'agent-reputation', 'fact-checking', 'veteran-services', 'federal-procurement', 'institutional-holdings', 'lobbying', 'patent-data', 'economic-indicators', 'labor-safety', 'medical-devices', 'campaign-finance', 'environmental-compliance', 'innovation-grants', 'congressional-legislation', 'regulatory-enforcement', 'medicare-data', 'research-grants', 'broker-verification', 'activist-investing', 'fails-to-deliver', 'short-squeeze-data', 'reg-sho', 'options-flow', 'dark-pool-data', 'position-sizing', 'trading-signals', 'aml-compliance', 'bank-audit', 'financial-crime-detection', 'content-moderation', 'misinformation-detection', 'wallet-reputation', 'rsi-heatmap', 'options-delta', 'technical-indicators', 'market-screener', 'greeks-data'], payment: { protocol: 'x402', rails: [{ id: 'standard', scheme: 'exact', network: 'base', settlement: 'facilitator', note: 'EIP-3009 via X-PAYMENT — settled through a hybrid facilitator chain.' }, { id: 'sovereign', scheme: 'exact', network: 'base', settlement: 'onchain-tx', note: 'Pay USDC then send X-PAYMENT-TX — verified directly on-chain, no facilitator.' }], facilitators: '/x402/facilitators' }, docs: { homepage: 'https://scriptmasterlabs.com', llms: 'https://mcp-x402.onrender.com/llms.txt', apiReference: 'https://github.com/Timwal78/SML_Portfolio/tree/main/mcp-x402' } },
    paths: { '/x402/grants': { get: {
      operationId: 'searchGrants',
      summary: 'Search live U.S. federal grant opportunities (Grants.gov Search2).',
      description: 'Returns real, current grant opportunities. Pay 0.02 USDC on Base, then call with X-PAYMENT-TX set to the transaction hash.',
      parameters: [
        { name: 'keyword', in: 'query', required: true, schema: { type: 'string' }, description: 'Search keywords or CFDA/assistance-listing number.', example: 'climate research' },
        { name: 'rows', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 } },
      ],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.02', amountUnits: '20000', payTo: X402_PAY_TO, settlement: 'onchain-tx', paymentHeader: 'X-PAYMENT-TX' },
      responses: { '200': { description: 'Live grant results' }, '402': { description: 'Payment required — pay USDC then retry with X-PAYMENT-TX.' } },
    } }, '/x402/firms': { get: {
      operationId: 'findFirms',
      summary: 'Find self-certified SDVOSB/WOSB/SDB/minority firms by NAICS + state (SAM.gov).',
      description: 'Returns registered firms with a self-certified socioeconomic flag, filtered by NAICS and optional state. Pay 0.08 USDC on Base, then call with X-PAYMENT-TX. Note: SBA-certified 8(a)/HUBZone status is not in SAM.',
      parameters: [
        { name: 'naics', in: 'query', required: true, schema: { type: 'string' }, description: '6-digit NAICS code.', example: '541512' },
        { name: 'state', in: 'query', required: false, schema: { type: 'string' }, description: '2-letter state code.' },
        { name: 'set_aside', in: 'query', required: false, schema: { type: 'string', enum: ['SDVOSB', 'WOSB', 'SDB', 'MINORITY'], default: 'SDVOSB' } },
        { name: 'rows', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 25, default: 10 } },
        { name: 'X-Sam-Key', in: 'header', required: false, schema: { type: 'string' }, description: 'BYOK: your own SAM.gov API key, takes priority over the server default.' },
      ],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.08', amountUnits: '80000', payTo: X402_PAY_TO, settlement: 'onchain-tx', paymentHeader: 'X-PAYMENT-TX' },
      responses: { '200': { description: 'Matching firms' }, '402': { description: 'Payment required — pay USDC then retry with X-PAYMENT-TX.' } },
    } }, '/x402/market': { get: {
      operationId: 'marketIntel',
      summary: 'Federal contract market intelligence by NAICS (USAspending).',
      description: 'Top incumbents (recipients) and top buying agencies by obligated dollars for a NAICS over a lookback window. Pay 0.30 USDC on Base, then call with X-PAYMENT-TX.',
      parameters: [
        { name: 'naics', in: 'query', required: true, schema: { type: 'string' }, description: '6-digit NAICS code.', example: '541512' },
        { name: 'years', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 10, default: 3 } },
      ],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.30', amountUnits: '300000', payTo: X402_PAY_TO, settlement: 'onchain-tx', paymentHeader: 'X-PAYMENT-TX' },
      responses: { '200': { description: 'Market intelligence' }, '402': { description: 'Payment required — pay USDC then retry with X-PAYMENT-TX.' } },
    } }, '/x402/drug-label': { get: {
      operationId: 'drugLabel',
      summary: 'FDA drug label lookup (openFDA).',
      description: 'Indications, dosage, warnings, interactions for a drug. Pay 0.05 USDC on Base.',
      parameters: [{ name: 'drug', in: 'query', required: true, schema: { type: 'string' }, description: 'Brand or generic drug name.', example: 'aspirin' }, { name: 'X-Openfda-Key', in: 'header', required: false, schema: { type: 'string' }, description: 'BYOK: your own openFDA API key, takes priority over the server default.' }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.05', amountUnits: '50000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Drug label' }, '402': { description: 'Payment required.' } },
    } }, '/x402/drug-recall': { get: {
      operationId: 'drugRecall',
      summary: 'FDA drug recall/enforcement search (openFDA).',
      description: 'Recall reason, classification, status, recalling firm. Pay 0.08 USDC on Base.',
      parameters: [{ name: 'drug', in: 'query', required: true, schema: { type: 'string' }, example: 'metformin' }, { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 20, default: 5 } }, { name: 'X-Openfda-Key', in: 'header', required: false, schema: { type: 'string' }, description: 'BYOK: your own openFDA API key, takes priority over the server default.' }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.08', amountUnits: '80000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Recalls' }, '402': { description: 'Payment required.' } },
    } }, '/x402/npi': { get: {
      operationId: 'npiLookup',
      summary: 'NPPES provider (NPI) lookup.',
      description: 'NPI, name, specialty, location, phone. Provide last_name, organization_name, or specialty. Pay 0.05 USDC on Base.',
      parameters: [{ name: 'last_name', in: 'query', required: false, schema: { type: 'string' }, example: 'Smith' }, { name: 'organization_name', in: 'query', required: false, schema: { type: 'string' } }, { name: 'specialty', in: 'query', required: false, schema: { type: 'string' }, example: 'Cardiology' }, { name: 'state', in: 'query', required: false, schema: { type: 'string' } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.05', amountUnits: '50000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Providers' }, '402': { description: 'Payment required.' } },
    } }, '/x402/clinical-trials': { get: {
      operationId: 'clinicalTrials',
      summary: 'Clinical trial search (ClinicalTrials.gov APIv2).',
      description: 'NCT ID, title, status, phase, enrollment, sponsor, conditions. Pay 0.08 USDC on Base.',
      parameters: [{ name: 'term', in: 'query', required: false, schema: { type: 'string' }, description: 'Drug, sponsor, or keyword.', example: 'diabetes' }, { name: 'condition', in: 'query', required: false, schema: { type: 'string' } }, { name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['RECRUITING', 'ACTIVE', 'COMPLETED', 'ALL'], default: 'RECRUITING' } }, { name: 'rows', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 25, default: 10 } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.08', amountUnits: '80000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Clinical trials' }, '402': { description: 'Payment required.' } },
    } }, '/x402/insider-trades': { get: {
      operationId: 'insiderTrades',
      summary: 'SEC EDGAR Form 4 insider trades by ticker.',
      description: 'Executive buy/sell filings from SEC EDGAR. Returns filing URLs with full Form 4 detail. Pay 0.20 USDC on Base.',
      parameters: [{ name: 'ticker', in: 'query', required: true, schema: { type: 'string' }, description: 'Stock ticker (e.g. TSLA, AMC, GME).', example: 'NVDA' }, { name: 'days', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 90, default: 30 } }, { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 25, default: 10 } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.20', amountUnits: '200000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Insider trades' }, '402': { description: 'Payment required.' } },
    } }, '/x402/drug-adverse-events': { get: {
      operationId: 'drugAdverseEvents',
      summary: 'FDA adverse event reports (openFDA FAERS).',
      description: 'Reactions, seriousness, outcomes for a drug from FDA safety reports. Pay 0.08 USDC on Base.',
      parameters: [{ name: 'drug', in: 'query', required: true, schema: { type: 'string' }, example: 'ibuprofen' }, { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 25, default: 10 } }, { name: 'X-Openfda-Key', in: 'header', required: false, schema: { type: 'string' }, description: 'BYOK: your own openFDA API key, takes priority over the server default.' }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.08', amountUnits: '80000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Adverse events' }, '402': { description: 'Payment required.' } },
    } }, '/x402/sec-8k': { get: {
      operationId: 'sec8k',
      summary: 'SEC EDGAR 8-K material event filings by ticker.',
      description: 'Earnings, CEO changes, M&A, and other material events. Pay 0.25 USDC on Base.',
      parameters: [{ name: 'ticker', in: 'query', required: true, schema: { type: 'string' }, example: 'AAPL' }, { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 20, default: 5 } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.25', amountUnits: '250000', payTo: X402_PAY_TO },
      responses: { '200': { description: '8-K filings' }, '402': { description: 'Payment required.' } },
    } }, '/x402/treasury-yields': { get: {
      operationId: 'treasuryYields',
      summary: 'Daily US Treasury yield curve rates (1M–30Y).',
      description: 'Official daily yield curve from Treasury.gov. Pay 0.05 USDC on Base.',
      parameters: [{ name: 'month', in: 'query', required: false, schema: { type: 'string' }, description: 'YYYYMM format (defaults to current month).', example: '202606' }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.05', amountUnits: '50000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Yield curve' }, '402': { description: 'Payment required.' } },
    } }, '/x402/entity-compliance': { get: {
      operationId: 'entityCompliance',
      summary: 'SAM entity compliance bundle: registration + exclusion + set-asides + NAICS.',
      description: 'Full compliance check by UEI or CAGE: active status, expiry, exclusion flag, set-aside certifications, size standard. Pay 0.35 USDC on Base.',
      parameters: [{ name: 'uei', in: 'query', required: false, schema: { type: 'string' }, description: 'SAM UEI (preferred).', example: 'JF19MPF74LN7' }, { name: 'cage', in: 'query', required: false, schema: { type: 'string' }, description: 'CAGE code (alternative).' }, { name: 'X-Sam-Key', in: 'header', required: false, schema: { type: 'string' }, description: 'BYOK: your own SAM.gov API key, takes priority over the server default.' }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.35', amountUnits: '350000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Compliance report' }, '402': { description: 'Payment required.' } },
    } }, '/x402/agent-score': { get: {
      operationId: 'agentScore',
      summary: 'AI agent FICO-style reputation score (300–850).',
      description: 'Submit behavioral signals (tasks, errors, payments) or retrieve score for an agent. Pay 0.20 USDC on Base.',
      parameters: [{ name: 'agent_id', in: 'query', required: true, schema: { type: 'string' }, example: 'agent-001' }, { name: 'action', in: 'query', required: false, schema: { type: 'string', enum: ['get', 'report'], default: 'get' } }, { name: 'tasks', in: 'query', required: false, schema: { type: 'integer' } }, { name: 'successes', in: 'query', required: false, schema: { type: 'integer' } }, { name: 'errors', in: 'query', required: false, schema: { type: 'integer' } }, { name: 'payments', in: 'query', required: false, schema: { type: 'integer' } }, { name: 'uptime', in: 'query', required: false, schema: { type: 'number' } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.20', amountUnits: '200000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Agent score' }, '402': { description: 'Payment required.' } },
    } }, '/x402/fact-check': { get: {
      operationId: 'factCheck',
      summary: 'Grounding oracle: fact-checks a claim against live government/FDA/SEC/Treasury data.',
      description: 'Submit any claim; auto-routes to the relevant primary source. Pay 0.15 USDC on Base.',
      parameters: [{ name: 'claim', in: 'query', required: true, schema: { type: 'string' }, example: 'The 10-year Treasury yield is above 4%' }, { name: 'domain', in: 'query', required: false, schema: { type: 'string', enum: ['grants', 'contracts', 'drug', 'provider', 'insider', 'yields', 'clinical', 'general'] } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.15', amountUnits: '150000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Fact-check result' }, '402': { description: 'Payment required.' } },
    } }, '/x402/sec-13f': { get: {
      operationId: 'sec13f',
      summary: 'SEC EDGAR 13F institutional holdings — hedge fund quarterly positions.',
      description: 'Returns the most recent 13F-HR filings for a fund or institution by CIK or name. Each result includes the filing URL linking to the full XML holdings table. Pay 0.25 USDC on Base.',
      parameters: [{ name: 'cik', in: 'query', required: false, schema: { type: 'string' }, description: '10-digit SEC CIK number (preferred).', example: '0001067983' }, { name: 'name', in: 'query', required: false, schema: { type: 'string' }, description: 'Institution or fund name (e.g. "Berkshire Hathaway").' }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.25', amountUnits: '250000', payTo: X402_PAY_TO },
      responses: { '200': { description: '13F filing list with URLs' }, '402': { description: 'Payment required.' } },
    } }, '/x402/lobbying': { get: {
      operationId: 'lobbyingDisclosures',
      summary: 'Senate LDA lobbying disclosure filings — client, registrant, issues, and amounts.',
      description: 'Search the Senate Lobbying Disclosure Act database by client name, registrant (lobbying firm), or issue code. Returns recent filings with activity detail. Pay 0.15 USDC on Base.',
      parameters: [{ name: 'client', in: 'query', required: false, schema: { type: 'string' }, description: 'The company or organization being lobbied for.', example: 'Google' }, { name: 'registrant', in: 'query', required: false, schema: { type: 'string' }, description: 'The lobbying firm or individual registrant.' }, { name: 'issue', in: 'query', required: false, schema: { type: 'string' }, description: 'LDA issue area code (e.g. TAX, HCR, DEF, ENV, TRD).' }, { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 25, default: 10 } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.15', amountUnits: '150000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Lobbying filings' }, '402': { description: 'Payment required.' } },
    } }, '/x402/patents': { get: {
      operationId: 'patentSearch',
      summary: 'USPTO PatentsView patent search — title, abstract, assignee, CPC class, grant date.',
      description: 'Search granted U.S. patents by keyword title or assignee (company). Returns patent ID, title, abstract snippet, CPC classification, and grant date. Pay 0.10 USDC on Base.',
      parameters: [{ name: 'query', in: 'query', required: false, schema: { type: 'string' }, description: 'Keyword or phrase to search in patent titles.', example: 'machine learning' }, { name: 'assignee', in: 'query', required: false, schema: { type: 'string' }, description: 'Assignee organization name (e.g. "Apple Inc").', example: 'Apple Inc' }, { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 25, default: 10 } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.10', amountUnits: '100000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Patent results' }, '402': { description: 'Payment required.' } },
    } }, '/x402/fred': { get: {
      operationId: 'fredSeries',
      summary: 'FRED economic indicator series (Federal Reserve Bank of St. Louis).',
      description: 'Retrieve observations for any FRED series: GDP, CPI, UNRATE, FEDFUNDS, T10Y2Y, and 800k+ others. Returns series metadata and latest observations in reverse chronological order. Pay 0.08 USDC on Base.',
      parameters: [{ name: 'series_id', in: 'query', required: true, schema: { type: 'string' }, description: 'FRED series ID (e.g. GDP, CPIAUCSL, UNRATE, FEDFUNDS, T10Y2Y, MORTGAGE30US).', example: 'GDP' }, { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } }, { name: 'X-Fred-Key', in: 'header', required: false, schema: { type: 'string' }, description: 'BYOK: your own FRED API key, takes priority over the server default.' }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.08', amountUnits: '80000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'FRED series observations' }, '402': { description: 'Payment required.' } },
    } }, '/x402/osha': { get: {
      operationId: 'oshaInspections',
      summary: 'OSHA workplace inspection and violation records (DOL enforcement data).',
      description: 'Search OSHA inspection records by establishment name, NAICS code, or state. Returns inspection activity type, citations, penalties, and open/closed status. Pay 0.10 USDC on Base.',
      parameters: [{ name: 'establishment', in: 'query', required: false, schema: { type: 'string' }, description: 'Establishment or employer name.', example: 'Amazon' }, { name: 'naics', in: 'query', required: false, schema: { type: 'string' }, description: '6-digit NAICS industry code.', example: '493110' }, { name: 'state', in: 'query', required: false, schema: { type: 'string' }, description: '2-letter U.S. state code.', example: 'TX' }, { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 25, default: 10 } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.10', amountUnits: '100000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'OSHA inspection records' }, '402': { description: 'Payment required.' } },
    } }, '/x402/fda-510k': { get: {
      operationId: 'fda510k',
      summary: 'FDA 510(k) medical device premarket clearances (openFDA).',
      description: 'Search FDA 510(k) clearances by device name or applicant (manufacturer). Returns K-number, decision date, product code, decision description, and link to FDA summary. Pay 0.08 USDC on Base.',
      parameters: [{ name: 'device', in: 'query', required: false, schema: { type: 'string' }, description: 'Device name or type (e.g. "pulse oximeter", "knee replacement").', example: 'pulse oximeter' }, { name: 'applicant', in: 'query', required: false, schema: { type: 'string' }, description: 'Manufacturer or applicant company name.', example: 'Medtronic' }, { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 25, default: 10 } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.08', amountUnits: '80000', payTo: X402_PAY_TO },
      responses: { '200': { description: '510(k) clearances' }, '402': { description: 'Payment required.' } },
    } }, '/x402/sec-10k': { get: {
      operationId: 'sec10k',
      summary: 'SEC EDGAR 10-K annual report filings by ticker.',
      description: 'Annual report (10-K) filing history for any public company. Returns dates and links to full 10-K documents on sec.gov. Pay 0.20 USDC on Base.',
      parameters: [{ name: 'ticker', in: 'query', required: true, schema: { type: 'string' }, example: 'AAPL' }, { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 10, default: 5 } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.20', amountUnits: '200000', payTo: X402_PAY_TO },
      responses: { '200': { description: '10-K annual filings' }, '402': { description: 'Payment required.' } },
    } }, '/x402/sec-10q': { get: {
      operationId: 'sec10q',
      summary: 'SEC EDGAR 10-Q quarterly report filings by ticker.',
      description: 'Quarterly report (10-Q) filing history for any public company. Returns dates and links to full 10-Q documents on sec.gov. Pay 0.15 USDC on Base.',
      parameters: [{ name: 'ticker', in: 'query', required: true, schema: { type: 'string' }, example: 'TSLA' }, { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 10, default: 5 } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.15', amountUnits: '150000', payTo: X402_PAY_TO },
      responses: { '200': { description: '10-Q quarterly filings' }, '402': { description: 'Payment required.' } },
    } }, '/x402/sec-13dg': { get: {
      operationId: 'sec13dg',
      summary: 'SEC EDGAR 13D/13G activist investor filings by ticker.',
      description: 'Who holds 5%+ stakes? Activist (13D) and passive (13G) large holder filings from SEC EDGAR. Pay 0.20 USDC on Base.',
      parameters: [{ name: 'ticker', in: 'query', required: true, schema: { type: 'string' }, example: 'GME' }, { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 20, default: 10 } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.20', amountUnits: '200000', payTo: X402_PAY_TO },
      responses: { '200': { description: '13D/13G activist filings' }, '402': { description: 'Payment required.' } },
    } }, '/x402/finra-broker': { get: {
      operationId: 'finraBroker',
      summary: 'FINRA BrokerCheck broker/advisor registration and disclosure history.',
      description: 'Search FINRA BrokerCheck for individual brokers or firms. Returns CRD number, registration status, disclosure count, and profile URL. Pay 0.15 USDC on Base.',
      parameters: [{ name: 'name', in: 'query', required: true, schema: { type: 'string' }, example: 'John Smith' }, { name: 'type', in: 'query', required: false, schema: { type: 'string', enum: ['individual', 'firm'], default: 'individual' } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.15', amountUnits: '150000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'BrokerCheck results' }, '402': { description: 'Payment required.' } },
    } }, '/x402/fec-finance': { get: {
      operationId: 'fecFinance',
      summary: 'FEC campaign finance — candidates, committees, and contribution totals.',
      description: 'Search FEC open data for political candidates or committees by name. Returns receipts, disbursements, party, and election cycle data. Pay 0.10 USDC on Base.',
      parameters: [{ name: 'name', in: 'query', required: false, schema: { type: 'string' }, example: 'Biden' }, { name: 'committee', in: 'query', required: false, schema: { type: 'string' } }, { name: 'cycle', in: 'query', required: false, schema: { type: 'string' }, example: '2024' }, { name: 'X-Fec-Key', in: 'header', required: false, schema: { type: 'string' }, description: 'BYOK: your own FEC API key, takes priority over the server default (falls back to the public DEMO_KEY if neither is set).' }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.10', amountUnits: '100000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'FEC campaign finance data' }, '402': { description: 'Payment required.' } },
    } }, '/x402/epa-violations': { get: {
      operationId: 'epaViolations',
      summary: 'EPA ECHO environmental enforcement and violation records.',
      description: 'Facility inspection history, citations, penalties, and compliance status from EPA ECHO. Search by facility name, state, or NAICS code. Pay 0.12 USDC on Base.',
      parameters: [{ name: 'facility', in: 'query', required: false, schema: { type: 'string' }, example: 'ExxonMobil' }, { name: 'state', in: 'query', required: false, schema: { type: 'string' }, example: 'TX' }, { name: 'naics', in: 'query', required: false, schema: { type: 'string' } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.12', amountUnits: '120000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'EPA enforcement records' }, '402': { description: 'Payment required.' } },
    } }, '/x402/sbir-grants': { get: {
      operationId: 'sbirGrants',
      summary: 'SBIR/STTR small business innovation research grants.',
      description: 'Search SBA/SBIR.gov for small business innovation grants. Filter by agency (DOD, NIH, NASA, NSF, DOE) and phase (1 or 2). Pay 0.05 USDC on Base.',
      parameters: [{ name: 'keyword', in: 'query', required: true, schema: { type: 'string' }, example: 'cybersecurity AI' }, { name: 'agency', in: 'query', required: false, schema: { type: 'string' }, example: 'DOD' }, { name: 'phase', in: 'query', required: false, schema: { type: 'string', enum: ['1', '2'] } }, { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 25, default: 10 } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.05', amountUnits: '50000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'SBIR/STTR grants' }, '402': { description: 'Payment required.' } },
    } }, '/x402/congress-bills': { get: {
      operationId: 'congressBills',
      summary: 'Congress.gov bill search — legislation by keyword and congress number.',
      description: 'Search bills by keyword for any Congress session. Returns bill number, title, latest action, sponsor, and Congress.gov URL. Requires CONGRESS_API_KEY (free at api.congress.gov). Pay 0.08 USDC on Base.',
      parameters: [{ name: 'query', in: 'query', required: true, schema: { type: 'string' }, example: 'artificial intelligence' }, { name: 'congress', in: 'query', required: false, schema: { type: 'string', default: '119' }, example: '119' }, { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 20, default: 10 } }, { name: 'X-Congress-Key', in: 'header', required: false, schema: { type: 'string' }, description: 'BYOK: your own Congress.gov API key, takes priority over the server default.' }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.08', amountUnits: '80000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Congressional bills' }, '402': { description: 'Payment required.' }, '503': { description: 'CONGRESS_API_KEY not configured on this server.' } },
    } }, '/x402/fda-warnings': { get: {
      operationId: 'fdaWarnings',
      summary: 'FDA warning letters — regulatory enforcement actions.',
      description: 'Search FDA warning letters by company or product type. Returns issuing office, subject, dates, and product category. Pay 0.10 USDC on Base.',
      parameters: [{ name: 'company', in: 'query', required: false, schema: { type: 'string' }, example: 'Purdue Pharma' }, { name: 'product', in: 'query', required: false, schema: { type: 'string' }, example: 'dietary supplement' }, { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 25, default: 10 } }, { name: 'X-Openfda-Key', in: 'header', required: false, schema: { type: 'string' }, description: 'BYOK: your own openFDA API key, takes priority over the server default.' }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.10', amountUnits: '100000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'FDA warning letters' }, '402': { description: 'Payment required.' } },
    } }, '/x402/cms-providers': { get: {
      operationId: 'cmsProviders',
      summary: 'CMS Medicare hospital quality data and physician provider information.',
      description: 'Hospital ratings, emergency services, and ownership from CMS Hospital General Information. Or Medicare Part D physician utilization data by state. Pay 0.10 USDC on Base.',
      parameters: [{ name: 'name', in: 'query', required: false, schema: { type: 'string' }, example: 'Mayo Clinic' }, { name: 'state', in: 'query', required: false, schema: { type: 'string' }, example: 'MN' }, { name: 'type', in: 'query', required: false, schema: { type: 'string', enum: ['hospital', 'physician'], default: 'hospital' } }, { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 20, default: 10 } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.10', amountUnits: '100000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'CMS provider data' }, '402': { description: 'Payment required.' } },
    } }, '/x402/nih-grants': { get: {
      operationId: 'nihGrants',
      summary: 'NIH Reporter research grant database.',
      description: 'Active NIH grants by keyword, institute (NCI, NHLBI, NIAID, NINDS, etc.), and fiscal year. Returns title, PI, organization, and award amount. Pay 0.05 USDC on Base.',
      parameters: [{ name: 'query', in: 'query', required: true, schema: { type: 'string' }, example: 'cancer immunotherapy' }, { name: 'agency', in: 'query', required: false, schema: { type: 'string' }, example: 'NCI' }, { name: 'fiscal_year', in: 'query', required: false, schema: { type: 'integer' }, example: 2025 }, { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 25, default: 10 } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.05', amountUnits: '50000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'NIH research grants' }, '402': { description: 'Payment required.' } },
    } }, '/x402/ftd-threshold-list': { get: {
      operationId: 'ftdThresholdList',
      summary: 'SEC Reg SHO Threshold Securities List — persistent fails-to-deliver names.',
      description: 'Current SEC Reg SHO threshold securities list. Keywords: reg sho, threshold securities, ftd threshold list, persistent fails to deliver, short squeeze data. Pay 0.02 USDC on Base.',
      parameters: [],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.02', amountUnits: '20000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Threshold securities list' }, '402': { description: 'Payment required.' } },
    } }, '/x402/ftd-time-series': { get: {
      operationId: 'ftdTimeSeries',
      summary: 'Historical SEC Reg SHO fails-to-deliver time series for a symbol.',
      description: 'Up to 180 days of FTD history for a symbol. Keywords: ftd time series, fails to deliver history, ftd data, reg sho history, short interest data. Pay 0.02 USDC on Base.',
      parameters: [{ name: 'symbol', in: 'query', required: true, schema: { type: 'string' }, example: 'GME' }, { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 180, default: 90 } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.02', amountUnits: '20000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'FTD time series' }, '402': { description: 'Payment required.' } },
    } }, '/x402/ftd-ratio': { get: {
      operationId: 'ftdRatio',
      summary: 'Latest FTD ratio and percentile rank for a symbol.',
      description: 'Latest FTD record, percentile rank within the rolling window, and threshold-list status. Keywords: ftd ratio, ftd percentile, fails to deliver ratio, threshold list status. Pay 0.03 USDC on Base.',
      parameters: [{ name: 'symbol', in: 'query', required: true, schema: { type: 'string' }, example: 'AMC' }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.03', amountUnits: '30000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'FTD ratio and percentile' }, '402': { description: 'Payment required.' } },
    } }, '/x402/ftd-etf-basket': { get: {
      operationId: 'ftdEtfBasket',
      summary: 'ETF constituents ranked by FTD notional concentration.',
      description: 'ETF constituents ranked by current FTD notional (XRT, IWM, IJR, KRE). Keywords: etf ftd basket, etf constituent ftd, meme etf concentration. Pay 0.05 USDC on Base.',
      parameters: [{ name: 'etf', in: 'query', required: true, schema: { type: 'string', enum: ['XRT', 'IWM', 'IJR', 'KRE'] }, example: 'IWM' }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.05', amountUnits: '50000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'ETF FTD basket breakdown' }, '402': { description: 'Payment required.' } },
    } }, '/x402/ftd-settlement-cycle': { get: {
      operationId: 'ftdSettlementCycle',
      summary: 'Settlement-cycle bundle — FTD stats, T+21/T+35 markers, Reg SHO 204 marker.',
      description: 'FTD stats, threshold-list status, T+21/T+35 calendar markers, and Reg SHO 204 13-day marker for a symbol. Keywords: settlement cycle, t+21 t+35, reg sho 204, close out marker. Pay 0.05 USDC on Base.',
      parameters: [{ name: 'symbol', in: 'query', required: true, schema: { type: 'string' }, example: 'GME' }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.05', amountUnits: '50000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Settlement-cycle bundle' }, '402': { description: 'Payment required.' } },
    } }, '/x402/options-flow': { get: {
      operationId: 'optionsFlow',
      summary: 'Institutional options flow — sweeps, whale detection, dark-pool prints.',
      description: 'Institutional options flow intelligence: sweeps, whale detection, unusual volume, dark-pool prints, Tradier brokerage-grade feed. Keywords: options flow, options sweep, whale options, dark pool options, unusual options volume. Pay 0.05 USDC on Base.',
      parameters: [{ name: 'symbol', in: 'query', required: false, schema: { type: 'string' }, example: 'IWM' }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.05', amountUnits: '50000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Options flow intelligence' }, '402': { description: 'Payment required.' } },
    } }, '/x402/cascade-signal': { post: {
      operationId: 'cascadeSignal',
      summary: 'CASCADE ACCUMULATOR directive — ACCUMULATE/PYRAMID/EXIT/STOP.',
      description: 'Position-sizing directive for a symbol: ACCUMULATE, PYRAMID, EXIT, or STOP. Keywords: cascade accumulator, accumulate pyramid exit stop, position sizing signal. Pay 0.25 USDC on Base.',
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] } } } },
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.25', amountUnits: '250000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'CASCADE directive' }, '402': { description: 'Payment required.' } },
    } }, '/x402/iam-model': { get: {
      operationId: 'iamModel',
      summary: 'Inevitable Action Model — obligation committee verdict and mandatory action.',
      description: 'Obligation committee verdict, Truth Layer state, and mandatory action for a symbol. Keywords: inevitable action model, obligation committee, truth layer, mandatory action signal. Pay 0.05 USDC on Base.',
      parameters: [{ name: 'symbol', in: 'query', required: true, schema: { type: 'string' }, example: 'TSLA' }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.05', amountUnits: '50000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'IAM resolution' }, '402': { description: 'Payment required.' } },
    } }, '/x402/compliance-anomaly': { post: {
      operationId: 'complianceAnomaly',
      summary: 'Submit a bank compliance anomaly for scoring.',
      description: 'Submit a bank compliance anomaly to the Leviathan Matrix swarm for scoring. Keywords: bank compliance anomaly, financial crime detection, aml anomaly report, compliance swarm. Pay 5.00 USDC on Base.',
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { bank_id: { type: 'string' }, agent_id: { type: 'string' }, trigger: { type: 'string' }, detail: { type: 'string' }, severity: { type: 'string' } }, required: ['bank_id', 'agent_id', 'trigger', 'detail'] } } } },
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '5.00', amountUnits: '5000000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Anomaly record and swarm response' }, '402': { description: 'Payment required.' } },
    } }, '/x402/compliance-audit': { post: {
      operationId: 'complianceAudit',
      summary: 'Full Leviathan Matrix compliance audit cycle for a bank.',
      description: 'Full compliance audit cycle for a financial institution. Keywords: bank audit, aml compliance audit, financial institution audit, regulatory audit cycle. Pay 5.00 USDC on Base.',
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { bank_id: { type: 'string' } }, required: ['bank_id'] } } } },
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '5.00', amountUnits: '5000000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Full audit cycle result' }, '402': { description: 'Payment required.' } },
    } }, '/x402/compliance-regulator-query': { get: {
      operationId: 'complianceRegulatorQuery',
      summary: 'Real-time regulator compliance dashboard query for a bank.',
      description: 'Real-time regulator compliance dashboard data for a bank. Keywords: regulator dashboard, real time bank compliance, regulatory query. Pay 2.50 USDC on Base.',
      parameters: [{ name: 'bank_id', in: 'query', required: true, schema: { type: 'string' } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '2.50', amountUnits: '2500000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Regulator dashboard data' }, '402': { description: 'Payment required.' } },
    } }, '/x402/max-conviction-signal': { post: {
      operationId: 'maxConvictionSignal',
      summary: 'TRIPLE_LOCK_VERDICT — max-conviction rare signal, distinct from the standard squeeze signal.',
      description: 'BULL or BEAR only when three independent engines (macro price stretch, dark-pool volume kinetics, ribbon harmonics) all agree; otherwise NO_TRIPLE_LOCK with the blocking engine named. Keywords: max conviction signal, rare squeeze signal, triple lock verdict, three engine consensus. Pay 0.25 USDC on Base.',
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] } } } },
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.25', amountUnits: '250000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Max-conviction verdict' }, '402': { description: 'Payment required.' } },
    } }, '/x402/content-trust-score': { post: {
      operationId: 'contentTrustScore',
      summary: 'Content misinformation trust scoring plus on-chain wallet trust ledger.',
      description: 'Content misinformation scoring and wallet trust ledger, distinct mechanism from AI Fact Check. Keywords: content trust score, misinformation detection, wallet trust score, agent content vetting. Pay 0.01 USDC on Base.',
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { content: { type: 'string' }, sender_wallet: { type: 'string' } }, required: ['content'] } } } },
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.01', amountUnits: '10000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Trust score, verdict, flags' }, '402': { description: 'Payment required.' } },
    } }, '/x402/equities-heatmap': { get: {
      operationId: 'equitiesHeatmap',
      summary: 'Equities RSI(14) heatmap across up to 20 tickers, with a real 4-agent Claude swarm verdict.',
      description: 'Real market data (Tradier preferred, falls back to Polygon.io) — RSI(14) computed for each ticker, grouped into a 4-bucket heatmap, plus a real multi-agent Claude swarm verdict. Keywords: RSI heatmap, equities overbought oversold, momentum screener. Pay 0.10 USDC on Base, then call with X-PAYMENT-TX.',
      parameters: [
        { name: 'tickers', in: 'query', required: false, schema: { type: 'string' }, description: 'Comma-separated tickers, up to 20. Defaults to AMC/GME/IWM plus real dynamically-discovered top movers.', example: 'AAPL,MSFT,NVDA' },
        { name: 'timeframe', in: 'query', required: false, schema: { type: 'string', enum: ['1h', '1d'], default: '1h' } },
        { name: 'X-Tradier-Key', in: 'header', required: false, schema: { type: 'string' }, description: 'BYOK: your own Tradier API key, takes priority over the server default.' },
        { name: 'X-Polygon-Key', in: 'header', required: false, schema: { type: 'string' }, description: 'BYOK: your own Polygon.io API key, takes priority over the server default.' },
        { name: 'X-Alpaca-Key', in: 'header', required: false, schema: { type: 'string' }, description: 'BYOK: your own Alpaca API key ID, paired with X-Alpaca-Secret.' },
        { name: 'X-Alpaca-Secret', in: 'header', required: false, schema: { type: 'string' }, description: 'BYOK: your own Alpaca API secret, paired with X-Alpaca-Key.' },
      ],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.10', amountUnits: '100000', payTo: X402_PAY_TO, settlement: 'onchain-tx', paymentHeader: 'X-PAYMENT-TX' },
      responses: { '200': { description: 'RSI heatmap + swarm verdict' }, '402': { description: 'Payment required — pay USDC then retry with X-PAYMENT-TX.' } },
    } }, '/x402/options-delta-heatmap': { get: {
      operationId: 'optionsDeltaHeatmap',
      summary: 'Options Delta heatmap across up to 40 contracts, with a real 4-agent Claude swarm verdict.',
      description: 'Real options chain data — Tradier real OPRA-fed Greeks preferred, falls back to Polygon.io with a locally modeled Black-Scholes Delta — grouped into a 4-bucket heatmap (deep OTM to deep ITM), plus a real multi-agent Claude swarm verdict. Keywords: options Delta heatmap, ITM OTM screener, Greeks scanner. Pay 0.15 USDC on Base, then call with X-PAYMENT-TX.',
      parameters: [
        { name: 'underlying', in: 'query', required: false, schema: { type: 'string' }, description: 'Underlying ticker. Defaults to AMC.', example: 'AMC' },
        { name: 'expiration_date', in: 'query', required: false, schema: { type: 'string' }, description: 'YYYY-MM-DD. Defaults to nearest available.' },
        { name: 'option_type', in: 'query', required: false, schema: { type: 'string', enum: ['call', 'put'], default: 'call' } },
        { name: 'X-Tradier-Key', in: 'header', required: false, schema: { type: 'string' }, description: 'BYOK: your own Tradier API key, takes priority over the server default.' },
        { name: 'X-Polygon-Key', in: 'header', required: false, schema: { type: 'string' }, description: 'BYOK: your own Polygon.io API key, takes priority over the server default.' },
      ],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.15', amountUnits: '150000', payTo: X402_PAY_TO, settlement: 'onchain-tx', paymentHeader: 'X-PAYMENT-TX' },
      responses: { '200': { description: 'Options Delta heatmap + swarm verdict' }, '402': { description: 'Payment required — pay USDC then retry with X-PAYMENT-TX.' } },
    } } },
    '/.well-known/x402': { get: { operationId: 'openApiDiscovery', summary: 'OpenAPI/x402 discovery document (free).', security: [], responses: { '200': { description: 'OpenAPI spec.' } } } },
    '/openapi.json': { get: { operationId: 'openApiJson', summary: 'OpenAPI spec (free).', security: [], responses: { '200': { description: 'OpenAPI spec.' } } } },
  };
  // x402scan/Bazaar discovery validation (per their docs/DISCOVERY.md) requires
  // every paid operation's x-payment-info to carry a `protocols` array and a
  // nested `price` object. Our existing flat fields (method/amount/etc.) stay
  // for richer clients; these two are added so the doc validates as x402.
  for (const pathItem of Object.values(OPENAPI_DOC.paths) as Array<Record<string, { 'x-payment-info'?: Record<string, unknown> }>>) {
    for (const method of ['get', 'post'] as const) {
      const op = pathItem[method];
      const pi = op?.['x-payment-info'];
      if (pi && typeof pi === 'object') {
        pi['protocols'] = ['x402'];
        pi['price'] = { mode: 'fixed', currency: 'USD', amount: pi['amount'] };
      }
    }
  }
  app.get('/.well-known/x402', (_req, res) => { res.set('Access-Control-Allow-Origin', '*').json(OPENAPI_DOC); });
  app.get('/openapi.json', (_req, res) => { res.set('Access-Control-Allow-Origin', '*').json(OPENAPI_DOC); });
  app.get('/favicon.ico', (_req, res) => {
    res.set('Content-Type', 'image/x-icon').set('Cache-Control', 'public, max-age=86400').send(FAVICON_ICO);
  });
  app.get('/x402/facilitators', (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*').json({
      rails: [
        { id: 'standard', header: 'X-PAYMENT', scheme: 'exact', network: 'base', asset: USDC_BASE_ASSET, settlement: 'facilitator-chain', chain: facilitatorChain().names },
        { id: 'sovereign', header: 'X-PAYMENT-TX', scheme: 'exact', network: 'base', asset: USDC_BASE_ASSET, settlement: 'onchain-verify' },
      ],
      payTo: X402_PAY_TO,
      note: 'Standard rail is settled through the listed facilitator chain (hybrid: tried in order, first success wins). Funds always settle to payTo regardless of facilitator. Sovereign rail needs no facilitator.',
    });
  });

  // Real, in-memory payment activity — counts and recent events only, no
  // simulated/seeded data. See security/x402-stats.ts. Resets on restart.
  app.get('/x402/stats', (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*').json(X402Stats.getInstance().snapshot());
  });

  // Root handler — service discovery for agents hitting / directly, PLUS the
  // AWS Marketplace fulfillment landing page. This product's "AI Agents &
  // Tools" listing type only accepts a bare domain for its Fulfillment URL
  // (rejects any path — confirmed live against the console), so a subscribing
  // customer's browser lands here, not at /aws/marketplace/resolve. Handles
  // both possibilities defensively since AWS's own docs are inconsistent
  // about whether this listing type still POSTs x-amzn-marketplace-token the
  // way classic SaaS Contract does: checks for the token in a POST body, a
  // GET query string (AWS's own fallback for "test modes"), and otherwise
  // serves agents JSON / browsers a real page instead of a raw JSON dump.
  const rootWelcomePage = (): string => `<!doctype html><html><head><meta charset="utf-8"><title>Script Master Labs — mcp-x402</title>
    <style>body{background:#050508;color:#e2e8f0;font-family:'Courier New',monospace;max-width:640px;margin:4rem auto;padding:0 1.5rem;line-height:1.6}
    h1{color:#a78bfa}p{color:#94a3b8}code{background:#0d0d14;border:1px solid #1e1e2e;border-radius:4px;padding:.1rem .4rem;color:#10ff80}a{color:#a78bfa}</style></head>
    <body><h1>Subscription received</h1>
    <p>If you just subscribed via AWS Marketplace, your API key is being provisioned — this can take a minute. Check your email, or if you have your AWS Marketplace order details handy, contact <a href="mailto:timothy.walton45@gmail.com">support</a> and reference your Customer ID.</p>
    <p>MCP endpoint: <code>https://mcp-x402.onrender.com/mcp</code></p>
    <p>Full docs: <a href="/llms.txt">llms.txt</a></p></body></html>`;
  app.get('/', async (req: Request, res: Response) => {
    const tokenFromQuery = typeof req.query['x-amzn-marketplace-token'] === 'string' ? (req.query['x-amzn-marketplace-token'] as string) : '';
    if (tokenFromQuery) {
      const result = await resolveAwsMarketplaceCustomer(tokenFromQuery);
      res.send(awsFulfillmentPage(result.ok ? { ok: true, apiKey: result.apiKey } : { ok: false, error: result.error }));
      return;
    }
    const acceptsHtml = typeof req.headers['accept'] === 'string' && req.headers['accept'].includes('text/html');
    if (acceptsHtml) {
      res.send(rootWelcomePage());
      return;
    }
    res.json({
      name: 'mcp-x402',
      version: VERSION,
      description: 'The x402 Amazon — 43+ tools, pay-per-call via XRPL. scriptmasterlabs.com',
      status: 'online',
      transport: 'streamable-http + sse',
      endpoints: {
        mcp_streamable: 'POST /mcp',
        sse_connect: 'GET /sse',
        sse_messages: 'POST /messages',
        health: 'GET /health',
        agentCard: 'GET /.well-known/agentcard.json',
        llms: 'GET /llms.txt',
      },
      links: {
        github: 'https://github.com/Timwal78/SML_Portfolio/tree/main/mcp-x402',
        homepage: 'https://scriptmasterlabs.com',
      },
    });
  });
  app.post('/', async (req: Request, res: Response) => {
    const token = typeof req.body?.['x-amzn-marketplace-token'] === 'string' ? req.body['x-amzn-marketplace-token'] : '';
    if (!token) {
      res.status(400).send(awsFulfillmentPage({ ok: false, error: 'missing_registration_token' }));
      return;
    }
    const result = await resolveAwsMarketplaceCustomer(token);
    res.send(awsFulfillmentPage(result.ok ? { ok: true, apiKey: result.apiKey } : { ok: false, error: result.error }));
  });

  // --- MONETIZATION FLYWHEEL (Credit Bureau & Paid Endpoints) ---

  const creditScores = new Map<string, number>();
  const freeTierUsage = new Map<string, { count: number, date: string }>();

  function getScore(did: string) {
    if (!creditScores.has(did)) creditScores.set(did, 300);
    return creditScores.get(did)!;
  }

  function recordPaidCall(did: string) {
    const score = getScore(did) + 5;
    const newScore = Math.min(score, 850);
    creditScores.set(did, newScore);
    return newScore;
  }

  const COUNCIL_PRICE = "0.10";
  const VIP_PRICE = "0.08";
  const PLATINUM_PRICE = "0.06";

  async function agentDidMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
    const proofHeader = req.headers["x-payment-proof"] as string | undefined;
    let agentDid = req.headers["x-agent-did"] as string | undefined;

    if (!agentDid && proofHeader) {
      try {
        const proof = JSON.parse(Buffer.from(proofHeader, "base64").toString("utf8"));
        agentDid = `did:poi:xrpl:${proof.payer}`;
      } catch { }
    }
    if (!agentDid) {
      agentDid = `did:anonymous:${req.ip?.replace(/[:.]/g, "-")}`;
    }
    (req as any).agentDid = agentDid;
    next();
  }

  async function freeTierRateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
    const did = (req as any).agentDid;
    const today = new Date().toISOString().slice(0, 10);
    let usage = freeTierUsage.get(did) || { count: 0, date: today };
    if (usage.date !== today) usage = { count: 0, date: today };

    usage.count++;
    freeTierUsage.set(did, usage);

    if (usage.count > 3) {
      res.status(429).json({
        error: "free_tier_exhausted",
        message: "Free tier limit: 3 calls/day. Upgrade via x402 payment.",
        upgradeEndpoint: "/api/council",
        price: COUNCIL_PRICE,
        currency: "RLUSD",
        network: process.env['XRPL_NETWORK'] ?? "xrpl-mainnet",
        yourScore: getScore(did)
      });
      return;
    }
    next();
  }

  async function dynamicPriceGate(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (LEVIATHAN_BYPASS_SECRET && req.headers['x-leviathan-key'] === LEVIATHAN_BYPASS_SECRET) {
      next(); return;
    }
    const did = (req as any).agentDid || "did:anonymous";
    const score = getScore(did);
    const proofHeader = req.headers["x-payment-proof"];

    if (proofHeader) {
      next();
      return;
    }

    const price = score >= 800 ? PLATINUM_PRICE : score >= 700 ? VIP_PRICE : COUNCIL_PRICE;
    const receivingAddress = process.env['XRPL_RECEIVING_ADDRESS'];
    if (!receivingAddress) {
      res.status(503).json({ error: 'payment_not_configured', message: 'XRPL_RECEIVING_ADDRESS not set' });
      return;
    }
    const requirements = {
      destination: receivingAddress,
      amount: price,
      currency: "RLUSD",
      network: process.env['XRPL_NETWORK'] ?? "xrpl-mainnet",
      description: `SqueezeOS Premium — ${price} RLUSD (Score: ${score})`,
      expiresAt: new Date(Date.now() + 60000).toISOString()
    };

    const encoded = Buffer.from(JSON.stringify(requirements)).toString("base64");
    res.status(402).setHeader("X-Payment-Requirements", encoded).json({
      error: "payment_required",
      protocol: "x402",
      price,
      currency: "RLUSD",
      agentCreditScore: score,
      vipEligible: score >= 700,
      requirements
    });
  }

  app.get("/api/beastmode", agentDidMiddleware, freeTierRateLimit, (req, res) => {
    const score = getScore((req as any).agentDid);
    res.json({
      tool: "beastmode", tier: "free",
      result: { status: "Awaiting Data", note: "Free tier preview only. Full scan requires /api/beastmode/full (0.10 RLUSD)", agentCreditScore: score },
      watermark: "ScriptMasterLabs — mcp-x402"
    });
  });

  app.get("/api/demo/council", agentDidMiddleware, freeTierRateLimit, (req, res) => {
    const score = getScore((req as any).agentDid);
    res.json({
      tool: "council_demo", tier: "free", councilMember: "RISK_SENTINEL",
      response: "Awaiting Data — connect wallet and pay for full council verdict.", agentCreditScore: score,
      watermark: "ScriptMasterLabs — mcp-x402"
    });
  });

  app.get("/api/credit-score", agentDidMiddleware, (req, res) => {
    const did = (req as any).agentDid;
    const score = getScore(did);
    res.json({ agentDid: did, creditScore: score, scale: "300-850", benefits: { "700+": "VIP 0.08 RLUSD", "800+": "Platinum 0.06 RLUSD" } });
  });

  app.post("/api/council", agentDidMiddleware, dynamicPriceGate, async (req, res) => {
    const agentDid = (req as any).agentDid as string;
    const symbol = (typeof req.body?.symbol === 'string' ? req.body.symbol : 'SPY').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    try {
      const result = await SqueezeOSAPI.council(symbol, agentDid);
      const newScore = recordPaidCall(agentDid);
      res.json({ tool: "council", tier: "paid", symbol, agentCreditScore: newScore, scoreGained: "+5", ...(result as object) });
    } catch (err) {
      res.status(502).json({ error: "upstream_error", message: String(err) });
    }
  });

  app.post("/api/beastmode/full", agentDidMiddleware, dynamicPriceGate, async (req, res) => {
    const agentDid = (req as any).agentDid as string;
    const symbol = (typeof req.body?.symbol === 'string' ? req.body.symbol : 'SPY').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    try {
      const result = await SqueezeOSAPI.council(symbol, agentDid);
      const newScore = recordPaidCall(agentDid);
      res.json({ tool: "beastmode_full", tier: "paid", symbol, agentCreditScore: newScore, scoreGained: "+5", ...(result as object) });
    } catch (err) {
      res.status(502).json({ error: "upstream_error", message: String(err) });
    }
  });

  // Streamable HTTP transport — used by claude.ai web connectors
  const streamableTransports = new Map<string, StreamableHTTPServerTransport>();

  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport = sessionId ? streamableTransports.get(sessionId) : undefined;

    if (!transport) {
      const newSessionId = randomUUID();
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => newSessionId });
      streamableTransports.set(newSessionId, transport);
      transport.onclose = () => streamableTransports.delete(newSessionId);
      const server = await createServer();
      await server.connect(transport);
      AuditLogger.getInstance().info('mcp_connect', { sessionId: newSessionId });
    }

    await transport.handleRequest(req, res, req.body);
  });

  // GET /mcp with no session returns service info instead of 404
  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const transport = sessionId ? streamableTransports.get(sessionId) : undefined;
    if (!transport) {
      res.json({
        name: 'mcp-x402',
        version: VERSION,
        protocol: 'MCP/streamable-http',
        status: 'ready',
        tools: '43+ tools available',
        how_to_connect: 'POST /mcp with a JSON-RPC initialize request',
        sse_alternative: 'GET /sse for legacy SSE transport',
        health: '/health',
        homepage: 'https://scriptmasterlabs.com',
      });
      return;
    }
    await transport.handleRequest(req, res);
  });

  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const transport = sessionId ? streamableTransports.get(sessionId) : undefined;
    if (!transport) { res.status(404).json({ error: 'session_not_found' }); return; }
    await transport.handleRequest(req, res);
  });

  const transports = new Map<string, SSEServerTransport>();
  const rateLimiter = RateLimiter.getInstance();

  app.get('/sse', async (req, res) => {
    const clientIp = req.ip ?? 'unknown';
    if (!rateLimiter.checkIp(clientIp)) {
      res.status(429).json({ error: 'rate_limit_exceeded', retry_after: 60 });
      return;
    }
    const transport = new SSEServerTransport('/messages', res);
    const sessionId = transport.sessionId;
    transports.set(sessionId, transport);
    const server = await createServer();
    await server.connect(transport);
    AuditLogger.getInstance().info('sse_connect', { sessionId, clientIp });
    res.on('close', async () => {
      transports.delete(sessionId);
      AuditLogger.getInstance().info('sse_disconnect', { sessionId });
      await server.close();
    });
  });

  app.post('/messages', async (req, res) => {
    const sessionId = req.query['sessionId'] as string | undefined;
    if (!sessionId) { res.status(400).json({ error: 'missing_session_id' }); return; }
    const transport = transports.get(sessionId);
    if (!transport) { res.status(404).json({ error: 'session_not_found' }); return; }
    // req.body is already parsed by the global express.json() middleware, which
    // consumes the raw request stream — handlePostMessage must be given that
    // parsed body explicitly (same as the /mcp handler below) or it tries to
    // re-read an already-drained stream and throws "stream is not readable".
    await transport.handlePostMessage(req, res, req.body);
  });

  const httpServer = await new Promise<ReturnType<typeof app.listen>>(
    (resolve) => {
      const s = app.listen(port, () => resolve(s));
    },
  );

  AuditLogger.getInstance().info('server_start', { transport: 'sse', port, version: VERSION });
  console.error(`[mcp-x402] listening on :${port} — health: http://localhost:${port}/health`);

  if (process.env['ACP_WALLET_ID'] && process.env['ACP_SIGNER_PRIVATE_KEY']) {
    import('./acp/leviathan.js').then(({ startLeviathan }) => {
      startLeviathan().catch((err: unknown) => {
        const e = err as Error & { details?: unknown; shortMessage?: string; statusCode?: number };
        console.error('[LEVIATHAN] Failed to start:', e.message,
          e.shortMessage ?? '', JSON.stringify(e.details ?? ''));
      });
    });
  } else {
    console.warn('[LEVIATHAN] Skipped — ACP_WALLET_ID or ACP_SIGNER_PRIVATE_KEY not set');
  }

  // Fire-and-forget: real, CloudTrail-visible GetEntitlements call so the
  // first deploy after AWS credentials are set satisfies AWS's listing audit
  // without waiting on an actual customer subscription. See marketplace.ts.
  runEntitlementsSelfCheck().catch((err: unknown) => {
    AuditLogger.getInstance().error('aws_mp_entitlements_selfcheck_unhandled', { error: String(err) });
  });

  const shutdown = async () => {
    AuditLogger.getInstance().info('server_stop', { transport: 'sse' });
    for (const [id] of transports) {
      AuditLogger.getInstance().info('sse_force_close', { sessionId: id });
    }
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  process.on('uncaughtException', (err) => {
    AuditLogger.getInstance().error('uncaught_exception', { error: String(err), stack: err.stack ?? '' });
  });
  process.on('unhandledRejection', (reason) => {
    AuditLogger.getInstance().error('unhandledRejection', { reason: String(reason) });
  });
}

const transport = process.env['MCP_TRANSPORT'] ?? 'stdio';
if (transport === 'sse') {
  runSSE().catch((err) => {
    console.error('[mcp-x402] fatal:', err);
    process.exit(1);
  });
} else {
  runStdio().catch((err) => {
    console.error('[mcp-x402] fatal:', err);
    process.exit(1);
  });
}
