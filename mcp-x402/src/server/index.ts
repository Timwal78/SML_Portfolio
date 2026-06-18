#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import cors from 'cors';
import { registerTools } from './tools/index.js';
import { AuditLogger } from './security/audit.js';
import { RateLimiter } from './security/rate-limit.js';

const VERSION = '1.0.0';

async function createServer(): Promise<McpServer> {
  const server = new McpServer(
    { name: 'mcp-x402', version: VERSION },
    {
      capabilities: {
        tools: {},
      },
    },
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
}

async function runSSE(): Promise<void> {
  const app = express();
  const port = parseInt(process.env['MCP_SSE_PORT'] ?? '3402', 10);

  app.use(cors({ origin: process.env['CORS_ORIGIN'] ?? '*' }));
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: VERSION, transport: 'sse' });
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

  const transports = new Map<string, SSEServerTransport>();
  const rateLimiter = RateLimiter.getInstance();

  app.get('/sse', async (req, res) => {
    const clientIp = req.ip ?? 'unknown';
    if (!rateLimiter.checkIp(clientIp)) {
      res.status(429).json({ error: 'rate_limit_exceeded' });
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
    if (!sessionId) {
      res.status(400).json({ error: 'missing_session_id' });
      return;
    }
    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: 'session_not_found' });
      return;
    }
    await transport.handlePostMessage(req, res);
  });

  await new Promise<void>((resolve) => app.listen(port, resolve));
  AuditLogger.getInstance().info('server_start', { transport: 'sse', port, version: VERSION });
  console.error(`[mcp-x402] SSE server listening on :${port}`);

  const shutdown = () => {
    AuditLogger.getInstance().info('server_stop', { transport: 'sse' });
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
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
