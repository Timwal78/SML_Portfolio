#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import cors from 'cors';
import { registerTools } from './tools/index.js';
import { AuditLogger } from './security/audit.js';
import { RateLimiter } from './security/rate-limit.js';
import { rapidApiGuard } from './security/rapidapi.js';
import { healthHandler } from './health.js';
import { verifyBaseUsdcPayment, alreadyRedeemed, markRedeemed, releaseRedeem } from './payments/verify-inbound.js';
import { facilitatorChain, decodePaymentHeader, type PaymentRequirements } from './payments/facilitators.js';

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
  app.use(express.json({ limit: '1mb' }));
  app.use(rapidApiGuard);

  // Health endpoint — hit every 30s by Docker healthcheck + keepalive cron
  app.get('/health', healthHandler);

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
  // x402 v2 spec: lean accepts array — no non-spec fields, CAIP-2 network, single standard entry.
  // The sovereign rail (X-PAYMENT-TX) is documented in description; its extra fields are non-spec.
  const buildAccepts = (resource: string, priceUnits: bigint, description: string): unknown[] => {
    const units = priceUnits.toString();
    const common = { scheme: 'exact', network: 'eip155:8453', maxAmountRequired: units, resource, description, mimeType: 'application/json', payTo: X402_PAY_TO, maxTimeoutSeconds: 300, asset: USDC_BASE_ASSET };
    return [{ ...common, extra: { name: 'USD Coin', version: '2' } }];
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
    const challenge: Record<string, unknown> = { x402Version: 2, error: 'payment_required', accepts };
    const header402 = Buffer.from(JSON.stringify(challenge)).toString('base64');

    const xPayment = typeof req.headers['x-payment'] === 'string' ? req.headers['x-payment'] : '';
    const txHash = typeof req.headers['x-payment-tx'] === 'string' ? req.headers['x-payment-tx'] : '';

    // Rail A — standard EIP-3009 via hybrid facilitator chain
    if (xPayment) {
      const payload = decodePaymentHeader(xPayment);
      if (!payload) { send402(res, challenge, header402, { error: 'invalid_payment_payload' }); return { ok: false }; }
      const result = await facilitatorChain().process(payload, accepts[0] as PaymentRequirements);
      if (!result.success) { send402(res, challenge, header402, { error: 'payment_unsettled', detail: result.errorReason ?? '' }); return { ok: false }; }
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
  const inlineDiscover402 = (resource: string, description: string): Record<string, unknown> => ({
    x402Version: 2, error: 'payment_required',
    accepts: [{ scheme: 'exact', network: 'eip155:8453', asset: USDC_BASE_ASSET, maxAmountRequired: '20000', resource, description, mimeType: 'application/json', payTo: X402_PAY_TO, maxTimeoutSeconds: 120, extra: { name: 'USD Coin', version: '2' } }],
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
    const samKey = process.env['SAM_API_KEY'];
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
  const fdaKey = process.env['OPENFDA_API_KEY'];

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
    const samKey = process.env['SAM_API_KEY'];
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

  // ── x402 discovery document (OpenAPI 3.1 + x-service-info / x-payment-info) ─
  // x402scan's canonical signal; served at /.well-known/x402 and /openapi.json.
  const OPENAPI_DOC = {
    openapi: '3.1.0',
    info: { title: 'Script Master Labs — x402 Data API', version: VERSION, description: 'Pay-per-call U.S. federal data, settled in USDC on Base via x402.', contact: { name: 'Script Master Labs', email: 'ScriptMasterLabs@gmail.com', url: 'https://scriptmasterlabs.com' } },
    servers: [{ url: 'https://mcp-x402.onrender.com' }],
    'x-service-info': { categories: ['government-data', 'grants', 'federal-contracts', 'market-intelligence', 'medical-reference', 'drug-data', 'healthcare-providers', 'clinical-trials', 'sec-filings', 'insider-trading', 'finance', 'drug-safety', 'treasury', 'yield-curve', 'compliance', 'entity-verification', 'agent-reputation', 'fact-checking', 'veteran-services', 'federal-procurement'], payment: { protocol: 'x402', rails: [{ id: 'standard', scheme: 'exact', network: 'base', settlement: 'facilitator', note: 'EIP-3009 via X-PAYMENT — settled through a hybrid facilitator chain.' }, { id: 'sovereign', scheme: 'exact', network: 'base', settlement: 'onchain-tx', note: 'Pay USDC then send X-PAYMENT-TX — verified directly on-chain, no facilitator.' }], facilitators: '/x402/facilitators' }, docs: { homepage: 'https://scriptmasterlabs.com', llms: 'https://mcp-x402.onrender.com/llms.txt', apiReference: 'https://github.com/Timwal78/SML_Portfolio/tree/main/mcp-x402' } },
    paths: { '/x402/grants': { get: {
      operationId: 'searchGrants',
      summary: 'Search live U.S. federal grant opportunities (Grants.gov Search2).',
      description: 'Returns real, current grant opportunities. Pay 0.02 USDC on Base, then call with X-PAYMENT-TX set to the transaction hash.',
      parameters: [
        { name: 'keyword', in: 'query', required: true, schema: { type: 'string' }, description: 'Search keywords or CFDA/assistance-listing number.' },
        { name: 'rows', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 } },
      ],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.02', amountUnits: '20000', payTo: X402_PAY_TO, settlement: 'onchain-tx', paymentHeader: 'X-PAYMENT-TX' },
      responses: { '200': { description: 'Live grant results' }, '402': { description: 'Payment required — pay USDC then retry with X-PAYMENT-TX.' } },
    } }, '/x402/firms': { get: {
      operationId: 'findFirms',
      summary: 'Find self-certified SDVOSB/WOSB/SDB/minority firms by NAICS + state (SAM.gov).',
      description: 'Returns registered firms with a self-certified socioeconomic flag, filtered by NAICS and optional state. Pay 0.08 USDC on Base, then call with X-PAYMENT-TX. Note: SBA-certified 8(a)/HUBZone status is not in SAM.',
      parameters: [
        { name: 'naics', in: 'query', required: true, schema: { type: 'string' }, description: '6-digit NAICS code.' },
        { name: 'state', in: 'query', required: false, schema: { type: 'string' }, description: '2-letter state code.' },
        { name: 'set_aside', in: 'query', required: false, schema: { type: 'string', enum: ['SDVOSB', 'WOSB', 'SDB', 'MINORITY'], default: 'SDVOSB' } },
        { name: 'rows', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 25, default: 10 } },
      ],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.08', amountUnits: '80000', payTo: X402_PAY_TO, settlement: 'onchain-tx', paymentHeader: 'X-PAYMENT-TX' },
      responses: { '200': { description: 'Matching firms' }, '402': { description: 'Payment required — pay USDC then retry with X-PAYMENT-TX.' } },
    } }, '/x402/market': { get: {
      operationId: 'marketIntel',
      summary: 'Federal contract market intelligence by NAICS (USAspending).',
      description: 'Top incumbents (recipients) and top buying agencies by obligated dollars for a NAICS over a lookback window. Pay 0.30 USDC on Base, then call with X-PAYMENT-TX.',
      parameters: [
        { name: 'naics', in: 'query', required: true, schema: { type: 'string' }, description: '6-digit NAICS code.' },
        { name: 'years', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 10, default: 3 } },
      ],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.30', amountUnits: '300000', payTo: X402_PAY_TO, settlement: 'onchain-tx', paymentHeader: 'X-PAYMENT-TX' },
      responses: { '200': { description: 'Market intelligence' }, '402': { description: 'Payment required — pay USDC then retry with X-PAYMENT-TX.' } },
    } }, '/x402/drug-label': { get: {
      operationId: 'drugLabel',
      summary: 'FDA drug label lookup (openFDA).',
      description: 'Indications, dosage, warnings, interactions for a drug. Pay 0.05 USDC on Base.',
      parameters: [{ name: 'drug', in: 'query', required: true, schema: { type: 'string' }, description: 'Brand or generic drug name.' }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.05', amountUnits: '50000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Drug label' }, '402': { description: 'Payment required.' } },
    } }, '/x402/drug-recall': { get: {
      operationId: 'drugRecall',
      summary: 'FDA drug recall/enforcement search (openFDA).',
      description: 'Recall reason, classification, status, recalling firm. Pay 0.08 USDC on Base.',
      parameters: [{ name: 'drug', in: 'query', required: true, schema: { type: 'string' } }, { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 20, default: 5 } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.08', amountUnits: '80000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Recalls' }, '402': { description: 'Payment required.' } },
    } }, '/x402/npi': { get: {
      operationId: 'npiLookup',
      summary: 'NPPES provider (NPI) lookup.',
      description: 'NPI, name, specialty, location, phone. Provide last_name, organization_name, or specialty. Pay 0.05 USDC on Base.',
      parameters: [{ name: 'last_name', in: 'query', required: false, schema: { type: 'string' } }, { name: 'organization_name', in: 'query', required: false, schema: { type: 'string' } }, { name: 'specialty', in: 'query', required: false, schema: { type: 'string' } }, { name: 'state', in: 'query', required: false, schema: { type: 'string' } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.05', amountUnits: '50000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Providers' }, '402': { description: 'Payment required.' } },
    } }, '/x402/clinical-trials': { get: {
      operationId: 'clinicalTrials',
      summary: 'Clinical trial search (ClinicalTrials.gov APIv2).',
      description: 'NCT ID, title, status, phase, enrollment, sponsor, conditions. Pay 0.08 USDC on Base.',
      parameters: [{ name: 'term', in: 'query', required: false, schema: { type: 'string' }, description: 'Drug, sponsor, or keyword.' }, { name: 'condition', in: 'query', required: false, schema: { type: 'string' } }, { name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['RECRUITING', 'ACTIVE', 'COMPLETED', 'ALL'], default: 'RECRUITING' } }, { name: 'rows', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 25, default: 10 } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.08', amountUnits: '80000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Clinical trials' }, '402': { description: 'Payment required.' } },
    } }, '/x402/insider-trades': { get: {
      operationId: 'insiderTrades',
      summary: 'SEC EDGAR Form 4 insider trades by ticker.',
      description: 'Executive buy/sell filings from SEC EDGAR. Returns filing URLs with full Form 4 detail. Pay 0.20 USDC on Base.',
      parameters: [{ name: 'ticker', in: 'query', required: true, schema: { type: 'string' }, description: 'Stock ticker (e.g. TSLA, AMC, GME).' }, { name: 'days', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 90, default: 30 } }, { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 25, default: 10 } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.20', amountUnits: '200000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Insider trades' }, '402': { description: 'Payment required.' } },
    } }, '/x402/drug-adverse-events': { get: {
      operationId: 'drugAdverseEvents',
      summary: 'FDA adverse event reports (openFDA FAERS).',
      description: 'Reactions, seriousness, outcomes for a drug from FDA safety reports. Pay 0.08 USDC on Base.',
      parameters: [{ name: 'drug', in: 'query', required: true, schema: { type: 'string' } }, { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 25, default: 10 } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.08', amountUnits: '80000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Adverse events' }, '402': { description: 'Payment required.' } },
    } }, '/x402/sec-8k': { get: {
      operationId: 'sec8k',
      summary: 'SEC EDGAR 8-K material event filings by ticker.',
      description: 'Earnings, CEO changes, M&A, and other material events. Pay 0.25 USDC on Base.',
      parameters: [{ name: 'ticker', in: 'query', required: true, schema: { type: 'string' } }, { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 20, default: 5 } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.25', amountUnits: '250000', payTo: X402_PAY_TO },
      responses: { '200': { description: '8-K filings' }, '402': { description: 'Payment required.' } },
    } }, '/x402/treasury-yields': { get: {
      operationId: 'treasuryYields',
      summary: 'Daily US Treasury yield curve rates (1M–30Y).',
      description: 'Official daily yield curve from Treasury.gov. Pay 0.05 USDC on Base.',
      parameters: [{ name: 'month', in: 'query', required: false, schema: { type: 'string' }, description: 'YYYYMM format (defaults to current month).' }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.05', amountUnits: '50000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Yield curve' }, '402': { description: 'Payment required.' } },
    } }, '/x402/entity-compliance': { get: {
      operationId: 'entityCompliance',
      summary: 'SAM entity compliance bundle: registration + exclusion + set-asides + NAICS.',
      description: 'Full compliance check by UEI or CAGE: active status, expiry, exclusion flag, set-aside certifications, size standard. Pay 0.35 USDC on Base.',
      parameters: [{ name: 'uei', in: 'query', required: false, schema: { type: 'string' }, description: 'SAM UEI (preferred).' }, { name: 'cage', in: 'query', required: false, schema: { type: 'string' }, description: 'CAGE code (alternative).' }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.35', amountUnits: '350000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Compliance report' }, '402': { description: 'Payment required.' } },
    } }, '/x402/agent-score': { get: {
      operationId: 'agentScore',
      summary: 'AI agent FICO-style reputation score (300–850).',
      description: 'Submit behavioral signals (tasks, errors, payments) or retrieve score for an agent. Pay 0.20 USDC on Base.',
      parameters: [{ name: 'agent_id', in: 'query', required: true, schema: { type: 'string' } }, { name: 'action', in: 'query', required: false, schema: { type: 'string', enum: ['get', 'report'], default: 'get' } }, { name: 'tasks', in: 'query', required: false, schema: { type: 'integer' } }, { name: 'successes', in: 'query', required: false, schema: { type: 'integer' } }, { name: 'errors', in: 'query', required: false, schema: { type: 'integer' } }, { name: 'payments', in: 'query', required: false, schema: { type: 'integer' } }, { name: 'uptime', in: 'query', required: false, schema: { type: 'number' } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.20', amountUnits: '200000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Agent score' }, '402': { description: 'Payment required.' } },
    } }, '/x402/fact-check': { get: {
      operationId: 'factCheck',
      summary: 'Grounding oracle: fact-checks a claim against live government/FDA/SEC/Treasury data.',
      description: 'Submit any claim; auto-routes to the relevant primary source. Pay 0.15 USDC on Base.',
      parameters: [{ name: 'claim', in: 'query', required: true, schema: { type: 'string' } }, { name: 'domain', in: 'query', required: false, schema: { type: 'string', enum: ['grants', 'contracts', 'drug', 'provider', 'insider', 'yields', 'clinical', 'general'] } }],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.15', amountUnits: '150000', payTo: X402_PAY_TO },
      responses: { '200': { description: 'Fact-check result' }, '402': { description: 'Payment required.' } },
    } } },
  };
  // x402scan/Bazaar discovery validation (per their docs/DISCOVERY.md) requires
  // every paid operation's x-payment-info to carry a `protocols` array and a
  // nested `price` object. Our existing flat fields (method/amount/etc.) stay
  // for richer clients; these two are added so the doc validates as x402.
  for (const pathItem of Object.values(OPENAPI_DOC.paths) as Array<Record<string, { 'x-payment-info'?: Record<string, unknown> }>>) {
    const op = pathItem['get'];
    const pi = op?.['x-payment-info'];
    if (pi && typeof pi === 'object') {
      pi['protocols'] = ['x402'];
      pi['price'] = { mode: 'fixed', currency: 'USD', amount: pi['amount'] };
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

  // Root handler — service discovery for agents hitting / directly
  app.get('/', (_req, res) => {
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

  app.post("/api/council", agentDidMiddleware, dynamicPriceGate, (req, res) => {
    const newScore = recordPaidCall((req as any).agentDid);
    res.json({
      tool: "council", tier: "paid", consensus: "Awaiting Data", agentCreditScore: newScore, scoreGained: "+5",
      note: "Route to SqueezeOS council endpoint for live verdict"
    });
  });

  app.post("/api/beastmode/full", agentDidMiddleware, dynamicPriceGate, (req, res) => {
    const newScore = recordPaidCall((req as any).agentDid);
    res.json({
      tool: "beastmode_full", tier: "paid", scan: "Awaiting Data",
      agentCreditScore: newScore, scoreGained: "+5"
    });
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
    await transport.handlePostMessage(req, res);
  });

  const httpServer = await new Promise<ReturnType<typeof app.listen>>(
    (resolve) => {
      const s = app.listen(port, () => resolve(s));
    },
  );

  AuditLogger.getInstance().info('server_start', { transport: 'sse', port, version: VERSION });
  console.error(`[mcp-x402] listening on :${port} — health: http://localhost:${port}/health`);

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
