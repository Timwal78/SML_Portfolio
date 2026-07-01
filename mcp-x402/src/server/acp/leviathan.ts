/**
 * LEVIATHAN — Virtuals Protocol ACP Seller Agent
 * ScriptMasterLabs | mcp-x402
 *
 * 20 institutional-grade offerings backed by live routes in this server.
 * Buyers pay USDC on Base via Virtuals Protocol ACP v2.
 * Calls are forwarded to the appropriate backend with X-Leviathan-Key bypass
 * (for x402 federal-data routes) or X-API-Key (for SqueezeOS signal routes).
 *
 * Required env vars:
 *   ACP_WALLET_ADDRESS      — Virtuals agent wallet
 *   ACP_WALLET_ID           — from app.virtuals.io → Signers tab
 *   ACP_SIGNER_PRIVATE_KEY  — from app.virtuals.io → Signers tab
 *   LEVIATHAN_BYPASS_SECRET — must match this server's LEVIATHAN_BYPASS_SECRET
 *   LEVIATHAN_BASE_URL      — this server's public URL (default: https://mcp-x402.onrender.com)
 *   SQUEEZEOS_API_BASE      — SqueezeOS backend (default: https://squeezeos-api.onrender.com)
 *   SML_API_KEY             — SqueezeOS OPERATOR_API_KEY for X-API-Key auth
 */

import {
  AcpAgent,
  PrivyAlchemyEvmProviderAdapter,
  AssetToken,
} from '@virtuals-protocol/acp-node-v2';
import type { JobSession, JobRoomEntry, AgentMessage } from '@virtuals-protocol/acp-node-v2';
import { base } from '@account-kit/infra';

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const WALLET_ADDRESS = (
  process.env['ACP_WALLET_ADDRESS'] ?? '0x0f035c36c4ce65a6f1bf4370f779bac722d59004'
) as `0x${string}`;

const WALLET_ID = (process.env['ACP_WALLET_ID'] ?? '').trim();
const SIGNER_PRIVATE_KEY = (process.env['ACP_SIGNER_PRIVATE_KEY'] ?? '').trim().replace(/^["']|["']$/g, '');
const BYPASS_SECRET = process.env['LEVIATHAN_BYPASS_SECRET'] ?? '';
const MCP_BASE = (
  process.env['LEVIATHAN_BASE_URL'] ?? 'https://mcp-x402.onrender.com'
).replace(/\/$/, '');
const SQUEEZEOS_BASE = (
  process.env['SQUEEZEOS_API_BASE'] ?? 'https://squeezeos-api.onrender.com'
).replace(/\/$/, '');
const SML_API_KEY = process.env['SML_API_KEY'] ?? '';

// ─── OFFERINGS CATALOG (live routes only) ────────────────────────────────────

interface Offering {
  price: number;
  description: string;
}

export const OFFERINGS: Record<string, Offering> = {
  // ── SqueezeOS Intelligence (SqueezeOS backend) ─────────────────────────────
  'SqueezeOS Council (7-Agent AI)': {
    price: 0.10,
    description:
      'Full 7-agent AI council verdict for any equity symbol via SqueezeOS. ' +
      'Req: { symbol: string }',
  },
  'SqueezeOS BeastMode Full Scan': {
    price: 0.10,
    description:
      'SqueezeOS full multi-engine scan — 741-EMA stack + 365-EMA + TripleLock composite. ' +
      'Req: { symbol: string }',
  },
  'SqueezeOS Squeeze Signal (741-EMA)': {
    price: 0.02,
    description:
      'SqueezeOS 741-EMA stack alignment signal with squeeze_alert flag. ' +
      'Returns BULLISH HIGHWAY / BEARISH HIGHWAY / CONSOLIDATION. Req: { symbol: string }',
  },
  'SqueezeOS 365-Day EMA Signal': {
    price: 0.03,
    description:
      'Price position vs 365-day EMA anchor (ABOVE / BELOW). Req: { symbol: string }',
  },
  'SqueezeOS Triple Lock Signal': {
    price: 0.05,
    description:
      'SML Triple Lock three-engine consensus (LOCKED BULL / LOCKED BEAR / FORMING / UNLOCKED). ' +
      'Req: { symbol: string }',
  },
  'SqueezeOS Full Signal (Composite)': {
    price: 0.10,
    description:
      'All three SqueezeOS engines in one sovereign verdict (741 + 365 + TripleLock). ' +
      'Req: { symbol: string }',
  },
  // ── Federal Data Intelligence (this server's x402 routes) ─────────────────
  'Federal Grants Intel': {
    price: 0.02,
    description:
      'Live federal grants data from Grants.gov. Req: { query: string, limit?: number }',
  },
  'Corporate Filings Search': {
    price: 0.08,
    description:
      'SAM.gov federal contract awards and corporate filings search. ' +
      'Req: { query: string, type?: string }',
  },
  'Market Intelligence Feed': {
    price: 0.30,
    description:
      'Real-time market intelligence data feed via USAspending.gov. Req: { symbol: string }',
  },
  'FDA Drug Label Lookup': {
    price: 0.05,
    description: 'FDA drug label information via openFDA. Req: { drug: string }',
  },
  'FDA Drug Recall Alert': {
    price: 0.08,
    description:
      'FDA drug recall enforcement reports via openFDA. Req: { drug?: string, limit?: number }',
  },
  'NPI Provider Lookup': {
    price: 0.05,
    description: 'National Provider Identifier registry lookup. Req: { query: string }',
  },
  'Clinical Trials Search': {
    price: 0.08,
    description: 'ClinicalTrials.gov study search. Req: { query: string, status?: string }',
  },
  'SEC Insider Trade Intel': {
    price: 0.20,
    description: 'SEC Form 4 insider trading activity for any ticker. Req: { ticker: string }',
  },
  'FDA Adverse Events Report': {
    price: 0.08,
    description: 'FDA FAERS adverse events for a drug. Req: { drug: string }',
  },
  'SEC 8-K Real-Time Filings': {
    price: 0.25,
    description: 'Real-time SEC 8-K material event filings for any ticker. Req: { ticker: string }',
  },
  'Treasury Yield Curve Data': {
    price: 0.05,
    description: 'Current US Treasury yield curve (1M through 30Y). Req: {}',
  },
  'Entity Compliance Check': {
    price: 0.35,
    description:
      'SAM.gov registration status + exclusion flag + set-aside types + NAICS codes. ' +
      'Req: { uei: string } or { cage: string }',
  },
  'Agent Credit Score': {
    price: 0.20,
    description:
      'AI agent FICO-style reputation score (300–850). Submit behavioral signals or retrieve score. ' +
      'Req: { agent_id: string, action?: "get"|"report", tasks?: number, successes?: number, errors?: number, payments?: number }',
  },
  'AI Fact Check': {
    price: 0.15,
    description:
      'Grounding oracle — fact-checks a claim against live government/FDA/SEC/Treasury data. ' +
      'Req: { claim: string, domain?: string }',
  },
};

// ─── BACKEND ROUTING ─────────────────────────────────────────────────────────

type Requirement = Record<string, string | number | boolean | undefined>;

async function callMcp(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, string>,
): Promise<unknown> {
  let url = `${MCP_BASE}${path}`;
  if (query && Object.keys(query).length > 0) {
    url = `${url}?${new URLSearchParams(query).toString()}`;
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Agent-DID': 'did:leviathan:acp:scriptmasterlabs',
  };
  if (BYPASS_SECRET) headers['X-Leviathan-Key'] = BYPASS_SECRET;

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '(unreadable)');
    throw new Error(`mcp-x402 ${method} ${path} → HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function callSqueezeOS(path: string): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (SML_API_KEY) headers['X-API-Key'] = SML_API_KEY;

  const res = await fetch(`${SQUEEZEOS_BASE}${path}`, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '(unreadable)');
    throw new Error(`SqueezeOS GET ${path} → HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function callSqueezeOSPost(path: string, body: Record<string, unknown>): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (SML_API_KEY) headers['X-API-Key'] = SML_API_KEY;

  const res = await fetch(`${SQUEEZEOS_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '(unreadable)');
    throw new Error(`SqueezeOS POST ${path} → HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function routeOffering(offering: string, req: Requirement): Promise<unknown> {
  const str = (v: string | number | boolean | undefined, fallback = ''): string =>
    v !== undefined ? String(v) : fallback;

  switch (offering) {
    // ── SqueezeOS (via SqueezeOS API) ─────────────────────────────────────────
    case 'SqueezeOS Council (7-Agent AI)':
    case 'SqueezeOS BeastMode Full Scan':
      return callSqueezeOSPost('/api/council', { symbol: str(req.symbol, 'SPY').toUpperCase() });

    case 'SqueezeOS Squeeze Signal (741-EMA)':
      return callSqueezeOS(`/api/signals/741/${encodeURIComponent(str(req.symbol, 'SPY').toUpperCase())}`);

    case 'SqueezeOS 365-Day EMA Signal':
      return callSqueezeOS(`/api/signals/365/${encodeURIComponent(str(req.symbol, 'SPY').toUpperCase())}`);

    case 'SqueezeOS Triple Lock Signal':
      return callSqueezeOS(`/api/signals/triplelock/${encodeURIComponent(str(req.symbol, 'SPY').toUpperCase())}`);

    case 'SqueezeOS Full Signal (Composite)':
      return callSqueezeOS(`/api/signals/full/${encodeURIComponent(str(req.symbol, 'SPY').toUpperCase())}`);

    // ── Federal data (via mcp-x402 x402 routes with bypass) ───────────────────
    case 'Federal Grants Intel':
      return callMcp('GET', '/x402/grants', undefined, {
        query: str(req.query),
        ...(req.limit ? { limit: str(req.limit) } : {}),
      });

    case 'Corporate Filings Search':
      return callMcp('GET', '/x402/firms', undefined, {
        query: str(req.query),
        ...(req.type ? { type: str(req.type) } : {}),
      });

    case 'Market Intelligence Feed':
      return callMcp('GET', '/x402/market', undefined, { symbol: str(req.symbol) });

    case 'FDA Drug Label Lookup':
      return callMcp('GET', '/x402/drug-label', undefined, { drug: str(req.drug) });

    case 'FDA Drug Recall Alert':
      return callMcp('GET', '/x402/drug-recall', undefined, {
        ...(req.drug ? { drug: str(req.drug) } : {}),
        ...(req.limit ? { limit: str(req.limit) } : {}),
      });

    case 'NPI Provider Lookup':
      return callMcp('GET', '/x402/npi', undefined, { query: str(req.query) });

    case 'Clinical Trials Search':
      return callMcp('GET', '/x402/clinical-trials', undefined, {
        query: str(req.query),
        ...(req.status ? { status: str(req.status) } : {}),
      });

    case 'SEC Insider Trade Intel':
      return callMcp('GET', '/x402/insider-trades', undefined, { ticker: str(req.ticker) });

    case 'FDA Adverse Events Report':
      return callMcp('GET', '/x402/drug-adverse-events', undefined, { drug: str(req.drug) });

    case 'SEC 8-K Real-Time Filings':
      return callMcp('GET', '/x402/sec-8k', undefined, { ticker: str(req.ticker) });

    case 'Treasury Yield Curve Data':
      return callMcp('GET', '/x402/treasury-yields');

    case 'Entity Compliance Check':
      return callMcp('GET', '/x402/entity-compliance', undefined, {
        ...(req.uei ? { uei: str(req.uei) } : {}),
        ...(req.cage ? { cage: str(req.cage) } : {}),
      });

    case 'Agent Credit Score':
      return callMcp('GET', '/x402/agent-score', undefined, {
        agent_id: str(req.agent_id),
        ...(req.action ? { action: str(req.action) } : {}),
        ...(req.tasks ? { tasks: str(req.tasks) } : {}),
        ...(req.successes ? { successes: str(req.successes) } : {}),
        ...(req.errors ? { errors: str(req.errors) } : {}),
        ...(req.payments ? { payments: str(req.payments) } : {}),
      });

    case 'AI Fact Check':
      return callMcp('GET', '/x402/fact-check', undefined, {
        claim: str(req.claim),
        ...(req.domain ? { domain: str(req.domain) } : {}),
      });

    default:
      throw new Error(`Unknown offering: ${offering}`);
  }
}

function extractRequirement(session: JobSession): Requirement {
  for (const entry of session.entries) {
    if (entry.kind === 'message' && entry.contentType === 'requirement') {
      try {
        return JSON.parse(entry.content) as Requirement;
      } catch {
        return {};
      }
    }
  }
  return {};
}

// ─── ENTRY HANDLER ───────────────────────────────────────────────────────────

async function handleEntry(session: JobSession, entry: JobRoomEntry): Promise<void> {
  if (entry.kind === 'system') {
    if (entry.event.type === 'job.funded') {
      const offering = session.job?.description ?? '';
      const requirement = extractRequirement(session);
      try {
        const result = await routeOffering(offering, requirement);
        await session.submit(JSON.stringify(result));
      } catch (err) {
        await session.reject(`LEVIATHAN error: ${(err as Error).message}`);
      }
    }
    return;
  }

  if (entry.kind === 'message' && entry.contentType === 'requirement' && session.status === 'open') {
    const msgEntry = entry as AgentMessage;
    const offering = session.job?.description ?? '';
    const spec = OFFERINGS[offering];
    if (!spec) {
      await session.reject(`LEVIATHAN does not offer: ${offering}`);
      return;
    }
    if (spec.price > 0) {
      await session.setBudget(AssetToken.usdc(spec.price, session.chainId));
    }
    void msgEntry;
  }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

export async function startLeviathan(): Promise<void> {
  if (!WALLET_ID || !SIGNER_PRIVATE_KEY) {
    throw new Error(
      'LEVIATHAN requires ACP_WALLET_ID and ACP_SIGNER_PRIVATE_KEY — ' +
      'get them from app.virtuals.io/acp/agents/ → Signers tab',
    );
  }
  if (!BYPASS_SECRET) {
    console.warn('[LEVIATHAN] LEVIATHAN_BYPASS_SECRET is not set — x402 gates will reject calls');
  }
  if (!SML_API_KEY) {
    console.warn('[LEVIATHAN] SML_API_KEY is not set — SqueezeOS signal calls will fail auth');
  }

  // Validate key format before handing to Privy — helps diagnose Render env var issues.
  const keyBytes = Buffer.from(SIGNER_PRIVATE_KEY, 'base64');
  console.log(`[LEVIATHAN] key bytes=${keyBytes.length} starts=${SIGNER_PRIVATE_KEY.slice(0,8)} ends=${SIGNER_PRIVATE_KEY.slice(-8)}`);
  if (keyBytes.indexOf(Buffer.from([0x04, 0x20])) === -1) {
    throw new Error(
      `Invalid wallet authorization private key — decoded to ${keyBytes.length} bytes, ` +
      `pattern 0x04 0x20 not found. Key may be truncated, URL-encoded, or wrong format.`,
    );
  }

  // Log raw ACP/Privy responses to diagnose auth failures.
  const _origFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const res = await _origFetch(input, init);
    if (url.includes('acp.virtuals.io') || url.includes('privy.io')) {
      const clone = res.clone();
      clone.text().then(body => {
        console.log(`[LEVIATHAN] ${init?.method ?? 'GET'} ${url} → ${res.status} ${body.slice(0, 400)}`);
      }).catch(() => {});
    }
    return res;
  };

  console.log(`[LEVIATHAN] walletId=${WALLET_ID} walletAddress=${WALLET_ADDRESS}`);
  let provider: Awaited<ReturnType<typeof PrivyAlchemyEvmProviderAdapter.create>>;
  try {
    provider = await PrivyAlchemyEvmProviderAdapter.create({
      walletAddress: WALLET_ADDRESS,
      walletId: WALLET_ID,
      // ACP SDK passes this directly to Privy's importPKCS8PrivateKey, which expects
      // PKCS#8 base64 — pass the key as-is from the Virtuals "Add Signer" UI.
      signerPrivateKey: SIGNER_PRIVATE_KEY as `0x${string}`,
      chains: [base],
    });
  } catch (err: unknown) {
    const e = err as Error & { details?: unknown; statusCode?: number; shortMessage?: string };
    console.error('[LEVIATHAN] PrivyAlchemyEvmProviderAdapter.create failed:', e.message,
      e.shortMessage ?? '', JSON.stringify(e.details ?? ''));
    throw err;
  }

  let seller: Awaited<ReturnType<typeof AcpAgent.create>>;
  try {
    seller = await AcpAgent.create({ provider });
  } catch (err: unknown) {
    const e = err as Error & { details?: unknown; statusCode?: number; shortMessage?: string };
    console.error('[LEVIATHAN] AcpAgent.create failed:', e.message,
      e.shortMessage ?? '', JSON.stringify(e.details ?? ''));
    throw err;
  }

  seller.on('entry', handleEntry);

  try {
    await seller.start(() => {
      console.log('LEVIATHAN online — 20 offerings on Virtuals ACP marketplace');
      console.log(`  wallet : ${WALLET_ADDRESS}`);
      console.log(`  mcp    : ${MCP_BASE}`);
      console.log(`  squeeze: ${SQUEEZEOS_BASE}`);
      console.log(`  bypass : ${BYPASS_SECRET ? 'configured' : 'WARNING: not set'}`);
      console.log(`  apikey : ${SML_API_KEY ? 'configured' : 'WARNING: not set'}`);
    });
  } catch (err: unknown) {
    const e = err as Error & { details?: unknown; statusCode?: number; shortMessage?: string };
    console.error('[LEVIATHAN] seller.start failed:', e.message,
      e.shortMessage ?? '', JSON.stringify(e.details ?? ''));
    throw err;
  }
}
