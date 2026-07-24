#!/usr/bin/env node
/**
 * One-command free demo — no wallet, no API keys.
 * Proves value in <10s against the live remote MCP host.
 *
 *   npx @scriptmasterlabs/mcp-x402 demo
 *   node scripts/demo-free.mjs
 */
import http from 'node:http';
import https from 'node:https';

const BASE = process.env.MCP_X402_URL || 'https://mcp-x402.onrender.com';

function request(method, path, body, extraHeaders = {}) {
  const u = new URL(path, BASE);
  const lib = u.protocol === 'https:' ? https : http;
  const data = body ? JSON.stringify(body) : null;
  const headers = {
    Accept: 'application/json, text/event-stream',
    'User-Agent': 'mcp-x402-demo/2.1.3',
    ...extraHeaders,
  };
  if (data) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(data);
  }
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers,
        timeout: 25000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    if (data) req.write(data);
    req.end();
  });
}

function parseSseOrJson(text) {
  // streamable-http may return SSE: event: message\ndata: {...}\n\n
  const dataLines = text
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .filter(Boolean);
  if (dataLines.length) {
    try {
      return JSON.parse(dataLines[dataLines.length - 1]);
    } catch {
      /* fall through */
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

async function main() {
  console.log('mcp-x402 free demo');
  console.log('host:', BASE);
  console.log('hooks: MCP · x402 pay-per-call · USDC/RLUSD · no API keys · 43+ tools\n');

  const health = await request('GET', '/health');
  console.log('1) GET /health →', health.status);
  try {
    const h = JSON.parse(health.body);
    console.log('   status:', h.status || h.version || 'ok', 'uptime:', h.uptime_human || h.uptime_seconds || '?');
  } catch {
    console.log('   body:', health.body.slice(0, 120));
  }

  const root = await request('GET', '/');
  console.log('2) GET / →', root.status);
  try {
    const j = JSON.parse(root.body);
    console.log('   name:', j.name, '|', (j.description || '').slice(0, 90));
    console.log('   mcp:', j.endpoints?.mcp_streamable || '/mcp');
  } catch {
    console.log('   body:', root.body.slice(0, 120));
  }

  // Initialize MCP session (free)
  const initBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'mcp-x402-demo', version: '2.1.3' },
    },
  };
  const init = await request('POST', '/mcp', initBody);
  const initJson = parseSseOrJson(init.body);
  const session =
    init.headers['mcp-session-id'] ||
    init.headers['Mcp-Session-Id'] ||
    init.headers['mcp-session-id'.toLowerCase()];
  console.log('3) MCP initialize →', init.status, session ? `session=${session}` : '');
  const serverName = initJson?.result?.serverInfo?.name || initJson?.result?.serverInfo?.version;
  if (serverName) console.log('   server:', JSON.stringify(initJson.result.serverInfo));

  // tools/list free
  const headers = {};
  if (session) headers['Mcp-Session-Id'] = session;
  // some servers want initialized notification first
  await request(
    'POST',
    '/mcp',
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    headers,
  );
  const listed = await request(
    'POST',
    '/mcp',
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    headers,
  );
  const listJson = parseSseOrJson(listed.body);
  const tools = listJson?.result?.tools || [];
  console.log('4) tools/list →', listed.status, 'tools:', tools.length);
  const names = tools.map((t) => t.name).slice(0, 12);
  if (names.length) console.log('   sample:', names.join(', '));

  // Try free discover-style tools if present
  const freeCandidates = [
    'sml_discover',
    'discover',
    'list_tools_catalog',
    'nexus_agent_hire',
    'ftd_threshold_scan',
  ];
  const have = new Set(tools.map((t) => t.name));
  let called = null;
  for (const name of freeCandidates) {
    if (!have.has(name) && tools.length) continue;
    if (!have.has(name) && tools.length === 0 && name !== 'sml_discover') continue;
    const args =
      name === 'nexus_agent_hire'
        ? { action: 'query', capability: 'gas fees', max_budget: '0.01' }
        : name === 'ftd_threshold_scan'
          ? { scan_type: 'alerts' }
          : {};
    const call = await request(
      'POST',
      '/mcp',
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name, arguments: args },
      },
      headers,
    );
    const callJson = parseSseOrJson(call.body);
    const ok = call.status >= 200 && call.status < 300 && !callJson?.error;
    console.log(`5) tools/call ${name} →`, call.status, ok ? 'OK' : 'see body');
    if (ok) {
      const text =
        callJson?.result?.content?.[0]?.text ||
        JSON.stringify(callJson?.result || callJson).slice(0, 240);
      console.log('   value:', String(text).slice(0, 240).replace(/\s+/g, ' '));
      called = name;
      break;
    }
    if (!have.has(name)) continue;
  }
  if (!called) {
    console.log('5) free tool call skipped or unavailable — catalog still listed above');
  }

  console.log(`
────────────────────────────────────────
INSTANT VALUE
  Free path: tools/list + discover-style tools (no API keys)
  Paid path: x402 USDC/RLUSD pay-per-call mid-loop

ONE-LINE REMOTE (Claude/Cursor):
{
  "mcpServers": {
    "sml": {
      "url": "https://mcp-x402.onrender.com/mcp",
      "transport": "streamable-http"
    }
  }
}

ACP micro-hire (stranger demand wedge):
  search scriptmasterlabs → gas_tracker $0.01 · rwa_intelligence $0.03

Site: https://www.scriptmasterlabs.com/agent-economy-os
npm i:  npx @scriptmasterlabs/mcp-x402
demo:   npm run demo   (this script)
────────────────────────────────────────`);
}

main().catch((e) => {
  console.error('demo failed:', e.message || e);
  process.exit(1);
});
