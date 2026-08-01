import { describe, it, expect, vi, afterEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// executeX402Payment has its own dedicated test coverage
// (tests/unit/x402-payment.test.ts) that exercises real verification
// against real facilitator/RPC calls. These tests are about
// nexus_agent_hire's OWN logic (posting the real job, computing the
// commission) — mock the payment step so it doesn't also need a real
// on-chain tx hash or facilitator response shape.
vi.mock('../../src/server/payments/x402.js', () => ({
  executeX402Payment: vi.fn().mockResolvedValue({
    receiptId: 'test-receipt',
    txHash: '0xfeedface',
    chain: 'base',
    amountPaid: '0.1000',
    currency: 'USDC',
    timestamp: Date.now(),
    walletAddress: '0xabc',
  }),
}));

const { registerNexus } = await import('../../src/server/tools/nexus.js');

/**
 * nexus_agent_hire used to call a dead host (api.scriptmasterlabs.com) with
 * no real backend anywhere. Fixed 2026-08-01: it's now backed by
 * SqueezeOS's real, live Agent Hiring Protocol board (GET/POST /api/hiring).
 * These tests drive the actual registered tool handler end to end with a
 * mocked fetch standing in for squeezeos-api.
 */

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

function captureHandler(): { server: McpServer; getHandler: () => ToolHandler } {
  let handler: ToolHandler | undefined;
  const server = {
    tool: (_name: string, _schema: unknown, cb: ToolHandler) => {
      handler = cb;
    },
  } as unknown as McpServer;
  return { server, getHandler: () => handler! };
}

function jsonOf(result: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(result.content[0]!.text);
}

afterEach(() => {
  vi.unstubAllGlobals();
  process.env['SML_API_KEY'] = '';
});

describe('nexus_agent_hire — query (free tier)', () => {
  it('browses the real SqueezeOS hiring board and filters by a recognized job_type', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ open_jobs: 1, jobs: [{ job_type: 'ANALYSIS', description: 'Analyze GME' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { server, getHandler } = captureHandler();
    registerNexus(server);
    const result = await getHandler()({ capability: 'ANALYSIS', max_budget: '1.00', action: 'query', wallet_address: '0xabc' });

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/api/hiring?type=ANALYSIS');
    const body = jsonOf(result) as { data: { jobs: unknown[] }; tier: string };
    expect(body.tier).toBe('free');
    expect(body.data.jobs).toHaveLength(1);
  });

  it('falls back to client-side keyword filtering when capability is not a real job_type', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        open_jobs: 2,
        jobs: [
          { job_type: 'CUSTOM', description: 'Options flow analysis for SPY' },
          { job_type: 'CUSTOM', description: 'Unrelated crypto arbitrage task' },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { server, getHandler } = captureHandler();
    registerNexus(server);
    const result = await getHandler()({ capability: 'options flow', max_budget: '1.00', action: 'query', wallet_address: '0xabc' });

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).not.toContain('type='); // no real job_type matched, so no server-side type filter
    const body = jsonOf(result) as { data: { jobs: Array<{ description: string }>; filtered_by_keyword: string } };
    expect(body.data.jobs).toHaveLength(1);
    expect(body.data.jobs[0]!.description).toContain('Options flow');
    expect(body.data.filtered_by_keyword).toBe('options flow');
  });

  it('reports upstream_unavailable honestly on a real fetch failure, never fabricating results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const { server, getHandler } = captureHandler();
    registerNexus(server);
    const result = await getHandler()({ capability: 'ANALYSIS', max_budget: '1.00', action: 'query', wallet_address: '0xabc' });
    expect(result.isError).toBe(true);
    expect(jsonOf(result)).toMatchObject({ error: 'upstream_unavailable' });
  });
});

describe('nexus_agent_hire — hire (paid tier)', () => {
  it('rejects hire without a valid XRPL wallet before ever calling the board or charging', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { server, getHandler } = captureHandler();
    registerNexus(server);
    const result = await getHandler()({ capability: 'Analyze GME', max_budget: '1.00', action: 'hire', wallet_address: '0xabc', xrpl_wallet: 'notxrpl' });
    expect(result.isError).toBe(true);
    expect(jsonOf(result)).toMatchObject({ error: 'xrpl_wallet_required' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts a real job to the board with the capability as description and max_budget as bounty', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ job_id: 'abc-123', status: 'OPEN' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { server, getHandler } = captureHandler();
    registerNexus(server);
    const result = await getHandler()({
      capability: 'Analyze GME squeeze setup',
      max_budget: '2.00',
      action: 'hire',
      wallet_address: '0xabc',
      xrpl_wallet: 'rExampleValidLookingXrplWallet1234',
      payment_tx_hash: '0x' + '1'.repeat(64),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/hiring/post'),
      expect.objectContaining({ method: 'POST' }),
    );
    const postedBody = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(postedBody.wallet).toBe('rExampleValidLookingXrplWallet1234');
    expect(postedBody.description).toBe('Analyze GME squeeze setup');
    expect(postedBody.bounty_rlusd).toBe(2);

    const body = jsonOf(result) as { data: { job_id: string }; commission: string };
    expect(body.data.job_id).toBe('abc-123');
    expect(body.commission).toContain('0.1000'); // 5% of 2.00
  });

  it('fetches (posts) BEFORE charging — a board failure never reaches payment', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', fetchMock);

    const { server, getHandler } = captureHandler();
    registerNexus(server);
    const result = await getHandler()({
      capability: 'Analyze GME',
      max_budget: '2.00',
      action: 'hire',
      wallet_address: '0xabc',
      xrpl_wallet: 'rExampleValidLookingXrplWallet1234',
    });

    expect(result.isError).toBe(true);
    expect(jsonOf(result)).toMatchObject({ error: 'upstream_unavailable' });
    // Only one fetch call (the failed post) — no payment/settlement call followed it.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
