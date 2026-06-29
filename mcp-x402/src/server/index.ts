#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { randomUUID } from 'crypto';
import cors from 'cors';
import { registerTools } from './tools/index.js';
import { AuditLogger } from './security/audit.js';
import { RateLimiter } from './security/rate-limit.js';
import { healthHandler } from './health.js';
import { verifyBaseUsdcPayment, alreadyRedeemed, markRedeemed } from './payments/verify-inbound.js';

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
  app.get('/x402/discover', (req, res) => {
    const resource = `https://${req.headers.host ?? 'mcp-x402.onrender.com'}${req.originalUrl}`;
    const challenge = { x402Version: 2, error: 'payment_required', accepts: [{ scheme: 'exact', network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', maxAmountRequired: '20000', resource, description: 'SML pay-per-call data tools — federal grants/contracts, market intel, SEC, FTD. Per-tool pricing via the sml_discover MCP tool.', mimeType: 'application/json', payTo: X402_PAY_TO, maxTimeoutSeconds: 120, inputSchema: { type: 'object', properties: { tool: { type: 'string', description: 'Tool name to price/call. See GET /x402/tool/{name}.' } } }, extra: { name: 'USDC', version: '2' } }] };
    res.status(402).set('PAYMENT-REQUIRED', Buffer.from(JSON.stringify(challenge)).toString('base64')).set('Access-Control-Expose-Headers', 'PAYMENT-REQUIRED').set('Access-Control-Allow-Origin', '*').json(challenge);
  });
  app.get('/x402/tool/:name', (req, res) => {
    const resource = `https://${req.headers.host ?? 'mcp-x402.onrender.com'}${req.originalUrl}`;
    const challenge = { x402Version: 2, error: 'payment_required', accepts: [{ scheme: 'exact', network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', maxAmountRequired: '20000', resource, description: `Paid SML tool ${req.params.name} — pay-per-call via x402, USDC on Base.`, mimeType: 'application/json', payTo: X402_PAY_TO, maxTimeoutSeconds: 120, inputSchema: { type: 'object', properties: { args: { type: 'object', description: 'Tool-specific arguments.' } } }, extra: { name: 'USDC', version: '2' } }] };
    res.status(402).set('PAYMENT-REQUIRED', Buffer.from(JSON.stringify(challenge)).toString('base64')).set('Access-Control-Expose-Headers', 'PAYMENT-REQUIRED').set('Access-Control-Allow-Origin', '*').json(challenge);
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
    const challenge = { x402Version: 2, error: 'payment_required', accepts: [{ scheme: 'exact', network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', maxAmountRequired: '20000', resource, description: 'Live U.S. federal grant search (Grants.gov Search2). Pay 0.02 USDC to payTo on Base, then retry with header X-PAYMENT-TX: <txHash>.', mimeType: 'application/json', payTo: X402_PAY_TO, maxTimeoutSeconds: 300, inputSchema, extra: { name: 'USDC', version: '2', settlement: 'onchain-tx', paymentHeader: 'X-PAYMENT-TX' } }] };
    const header402 = Buffer.from(JSON.stringify(challenge)).toString('base64');

    const txHash = (req.headers['x-payment-tx'] as string | undefined) ?? '';
    if (!txHash) {
      return res.status(402).set('PAYMENT-REQUIRED', header402).set('Access-Control-Expose-Headers', 'PAYMENT-REQUIRED').set('Access-Control-Allow-Origin', '*').json(challenge);
    }
    if (alreadyRedeemed(txHash)) {
      return res.status(402).set('Access-Control-Allow-Origin', '*').json({ ...challenge, error: 'payment_already_redeemed', detail: 'This transaction hash was already used. Send a new payment.' });
    }
    const v = await verifyBaseUsdcPayment({ txHash, payTo: X402_PAY_TO, minAmountUnits: GRANTS_PRICE_UNITS });
    if (!v.ok) {
      return res.status(402).set('PAYMENT-REQUIRED', header402).set('Access-Control-Expose-Headers', 'PAYMENT-REQUIRED').set('Access-Control-Allow-Origin', '*').json({ ...challenge, error: 'payment_unverified', detail: v.error });
    }
    if (!keyword) {
      return res.status(400).set('Access-Control-Allow-Origin', '*').json({ error: 'missing_keyword', detail: 'Payment verified. Add ?keyword= and retry with the same X-PAYMENT-TX.' });
    }
    try {
      const r = await fetch('https://api.grants.gov/v1/api/search2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword, oppStatuses: 'posted', rows }) });
      if (!r.ok) {
        return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'grants_api_error', status: r.status });
      }
      const j = await r.json() as { data?: { hitCount?: number; oppHits?: unknown[] } };
      const results = j.data?.oppHits ?? [];
      markRedeemed(txHash);
      return res.set('Access-Control-Allow-Origin', '*').json({ source: 'grants.gov/search2', total: j.data?.hitCount ?? results.length, results, _paid: { tx: txHash, from: v.from ?? '', amount_units: String(v.amountUnits ?? ''), asset: 'USDC', network: 'base' } });
    } catch (err) {
      return res.status(502).set('Access-Control-Allow-Origin', '*').json({ error: 'grants_fetch_failed', message: String(err) });
    }
  });

  // ── x402 discovery document (OpenAPI 3.1 + x-service-info / x-payment-info) ─
  // x402scan's canonical signal; served at /.well-known/x402 and /openapi.json.
  const OPENAPI_DOC = {
    openapi: '3.1.0',
    info: { title: 'Script Master Labs — x402 Data API', version: VERSION, description: 'Pay-per-call U.S. federal data, settled in USDC on Base via x402.' },
    servers: [{ url: 'https://mcp-x402.onrender.com' }],
    'x-service-info': { categories: ['government-data', 'grants', 'federal-contracts', 'market-intelligence'], docs: { homepage: 'https://scriptmasterlabs.com', llms: 'https://mcp-x402.onrender.com/llms.txt', apiReference: 'https://github.com/Timwal78/SML_Portfolio/tree/main/mcp-x402' } },
    paths: { '/x402/grants': { get: {
      operationId: 'searchGrants',
      summary: 'Search live U.S. federal grant opportunities (Grants.gov Search2).',
      description: 'Returns real, current grant opportunities. Pay 0.02 USDC on Base, then call with X-PAYMENT-TX set to the transaction hash.',
      parameters: [
        { name: 'keyword', in: 'query', required: true, schema: { type: 'string' }, description: 'Search keywords or CFDA/assistance-listing number.' },
        { name: 'rows', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 } },
      ],
      'x-payment-info': { method: 'x402', scheme: 'exact', network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', currency: 'USDC', amount: '0.02', amountUnits: '20000', payTo: X402_PAY_TO, settlement: 'onchain-tx', paymentHeader: 'X-PAYMENT-TX' },
      responses: { '200': { description: 'Live grant results' }, '402': { description: 'Payment required — pay USDC then retry with X-PAYMENT-TX.' } },
    } } },
  };
  app.get('/.well-known/x402', (_req, res) => { res.set('Access-Control-Allow-Origin', '*').json(OPENAPI_DOC); });
  app.get('/openapi.json', (_req, res) => { res.set('Access-Control-Allow-Origin', '*').json(OPENAPI_DOC); });

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
