import { Hono } from 'hono';
import type { Env } from '../types/index.js';

export const mcpRouter = new Hono<{ Bindings: Env }>();

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'xaap', version: '1.0.0' };

const TOOLS = [
  {
    name: 'get_ticker_health',
    description: 'Get corporate health score and grade for a ticker symbol. Free endpoint.',
    inputSchema: {
      type: 'object',
      properties: { symbol: { type: 'string', description: 'Stock ticker symbol (e.g. AAPL)' } },
      required: ['symbol'],
    },
  },
  {
    name: 'list_tickers',
    description: 'List all tickers covered by xAAP auditors. Free endpoint.',
    inputSchema: {
      type: 'object',
      properties: {
        grade: { type: 'string', enum: ['A+', 'A', 'B', 'C', 'D', 'F'], description: 'Filter by health grade' },
        limit: { type: 'number', description: 'Max results (default 20, max 100)' },
      },
    },
  },
  {
    name: 'get_findings',
    description: 'Get forensic findings for a ticker. Requires x402 payment ($0.01 USDC on Base).',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol' },
        payment_token: { type: 'string', description: 'x402 payment proof from Base network' },
        severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'get_finding_detail',
    description: 'Get full forensic thesis for a finding ID. Price varies by auditor tier. Requires x402 payment.',
    inputSchema: {
      type: 'object',
      properties: {
        finding_id: { type: 'string', description: 'Finding UUID' },
        payment_token: { type: 'string', description: 'x402 payment proof' },
      },
      required: ['finding_id'],
    },
  },
  {
    name: 'get_auditor_profile',
    description: 'Get auditor reputation, tier, accuracy rate, and finding history. Free endpoint.',
    inputSchema: {
      type: 'object',
      properties: { address: { type: 'string', description: 'EVM wallet address' } },
      required: ['address'],
    },
  },
  {
    name: 'get_leaderboard',
    description: 'Get global auditor leaderboard ranked by reputation score. Free endpoint.',
    inputSchema: {
      type: 'object',
      properties: {
        tier: { type: 'string', enum: ['CITIZEN', 'DETECTIVE', 'INVESTIGATOR', 'AUDITOR', 'GRAND_INQUISITOR'] },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'query_forensics',
    description: 'Natural language forensic query (e.g. "Any red flags at Tesla?"). $0.05 USDC.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Natural language question about a company' },
        payment_token: { type: 'string', description: 'x402 payment proof' },
      },
      required: ['question'],
    },
  },
  {
    name: 'get_recent_filings',
    description: 'Get recently processed SEC EDGAR filings with forensic scores. Free endpoint.',
    inputSchema: {
      type: 'object',
      properties: {
        form_type: { type: 'string', description: '10-K, 10-Q, 8-K, etc.' },
        ticker: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'register_auditor',
    description: 'Register as an xAAP auditor. Wallet address is your identity. Free.',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'EVM wallet address (lowercase)' },
        display_name: { type: 'string' },
        bio: { type: 'string' },
        referrer_address: { type: 'string', description: 'Referring auditor address for referral bonus' },
      },
      required: ['address'],
    },
  },
  {
    name: 'submit_finding',
    description: 'Submit a forensic finding for jury review. INVESTIGATOR+ tier required for premium pricing.',
    inputSchema: {
      type: 'object',
      properties: {
        ticker: { type: 'string' },
        auditor_address: { type: 'string' },
        title: { type: 'string' },
        summary: { type: 'string', description: 'Public 1-2 sentence preview' },
        full_thesis: { type: 'string', description: 'Complete forensic analysis' },
        severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
        category: { type: 'string', enum: ['RELATED_PARTY', 'AUDITOR_CHANGE', 'GOING_CONCERN', 'REVENUE_RECOGNITION', 'EXECUTIVE_COMP', 'SUBSIDIARY', 'INSIDER_TRADING', 'OTHER'] },
        price_usdc: { type: 'string', description: 'Price in USDC smallest units (6 decimals). Min: 10000 ($0.01)' },
        filing_accession: { type: 'string', description: 'SEC accession number if filing-based' },
      },
      required: ['ticker', 'auditor_address', 'title', 'summary', 'full_thesis', 'severity', 'category', 'price_usdc'],
    },
  },
  {
    name: 'get_loyalty_status',
    description: 'Get auditor loyalty tier, streak, achievements, and next-tier requirements.',
    inputSchema: {
      type: 'object',
      properties: { address: { type: 'string' } },
      required: ['address'],
    },
  },
  {
    name: 'register_agent',
    description: 'Register an AI agent for affiliate revenue sharing (15% of protocol fees).',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Unique agent identifier (becomes X-Agent-Id header)' },
        name: { type: 'string' },
        description: { type: 'string' },
        owner_address: { type: 'string' },
      },
      required: ['agent_id', 'name'],
    },
  },
];

mcpRouter.post('/', async (c) => {
  const body = await c.req.json<{ jsonrpc: string; id?: unknown; method: string; params?: unknown }>();
  const { method, id, params } = body;

  const respond = (result: unknown) => c.json({ jsonrpc: '2.0', id, result });
  const error = (code: number, message: string) =>
    c.json({ jsonrpc: '2.0', id, error: { code, message } });

  switch (method) {
    case 'initialize':
      return respond({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: 'xAAP — Decentralized adversarial audit protocol. Use get_ticker_health and list_tickers for free. Findings require x402 USDC payment on Base mainnet. Register your agent with register_agent to earn 15% affiliate fees on all traffic you generate.',
      });

    case 'tools/list':
      return respond({ tools: TOOLS });

    case 'tools/call': {
      const p = params as { name: string; arguments?: Record<string, unknown> };
      return respond({ content: [{ type: 'text', text: await dispatch(p.name, p.arguments ?? {}, c.env) }] });
    }

    case 'ping':
      return respond({});

    default:
      if (method.startsWith('notifications/')) return c.body(null, 204);
      return error(-32601, 'Method not found');
  }
});

async function dispatch(tool: string, args: Record<string, unknown>, env: Env): Promise<string> {
  const BASE = 'https://xaap.scriptmasterlabs.com';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (args['payment_token']) headers['X-Payment'] = String(args['payment_token']);

  switch (tool) {
    case 'get_ticker_health': {
      const r = await fetch(`${BASE}/api/v1/tickers/${args['symbol']}`);
      return r.text();
    }
    case 'list_tickers': {
      const qs = new URLSearchParams();
      if (args['grade']) qs.set('grade', String(args['grade']));
      if (args['limit']) qs.set('limit', String(args['limit']));
      const r = await fetch(`${BASE}/api/v1/tickers?${qs}`);
      return r.text();
    }
    case 'get_findings': {
      const qs = args['severity'] ? `?severity=${args['severity']}` : '';
      const r = await fetch(`${BASE}/api/v1/tickers/${args['symbol']}/findings${qs}`, { headers });
      return r.text();
    }
    case 'get_finding_detail': {
      const r = await fetch(`${BASE}/api/v1/findings/${args['finding_id']}`, { headers });
      return r.text();
    }
    case 'get_auditor_profile': {
      const r = await fetch(`${BASE}/api/v1/auditors/${args['address']}`);
      return r.text();
    }
    case 'get_leaderboard': {
      const qs = new URLSearchParams();
      if (args['tier']) qs.set('tier', String(args['tier']));
      if (args['limit']) qs.set('limit', String(args['limit']));
      const r = await fetch(`${BASE}/api/v1/auditors?${qs}`);
      return r.text();
    }
    case 'query_forensics': {
      const r = await fetch(`${BASE}/api/v1/query`, {
        method: 'POST', headers,
        body: JSON.stringify({ question: args['question'] }),
      });
      return r.text();
    }
    case 'get_recent_filings': {
      const qs = new URLSearchParams();
      if (args['form_type']) qs.set('form_type', String(args['form_type']));
      if (args['ticker']) qs.set('ticker', String(args['ticker']));
      if (args['limit']) qs.set('limit', String(args['limit']));
      const r = await fetch(`${BASE}/api/v1/edgar/recent?${qs}`);
      return r.text();
    }
    case 'register_auditor': {
      const r = await fetch(`${BASE}/api/v1/auditors/register`, {
        method: 'POST', headers,
        body: JSON.stringify(args),
      });
      return r.text();
    }
    case 'submit_finding': {
      const r = await fetch(`${BASE}/api/v1/findings`, {
        method: 'POST', headers,
        body: JSON.stringify(args),
      });
      return r.text();
    }
    case 'get_loyalty_status': {
      const r = await fetch(`${BASE}/api/v1/loyalty/${args['address']}`);
      return r.text();
    }
    case 'register_agent': {
      const r = await fetch(`${BASE}/api/v1/agents/register`, {
        method: 'POST', headers,
        body: JSON.stringify(args),
      });
      return r.text();
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${tool}` });
  }
}
