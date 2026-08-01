const SQUEEZEOS_BASE = process.env['SQUEEZEOS_BASE_URL'] ?? process.env['SQUEEZEOS_API_BASE'] ?? 'https://squeezeos-api.onrender.com';
const SML_API_KEY = process.env['SML_API_KEY'] ?? '';

/**
 * Auth note: SqueezeOS's premium routes are gated by two different decorators.
 * `require_payment` (proof402_integration.py) recognizes X-Payment-Token JWTs
 * AND an X-API-Key operator-key bypass. `x402_guard` (x402_flask.py) — which
 * gates /api/council, /api/scan, /api/options, /api/iwm — never recognized
 * X-Payment-Token at all, only a real on-chain X-PAYMENT header or (as of
 * SqueezeOS PR #249) the same X-API-Key operator-key bypass. This module
 * previously minted a self-signed X-Payment-Token JWT for these four calls,
 * which meant they always 402'd against x402_guard, regardless of the caller
 * already having paid mcp-x402 for the call. Using X-API-Key uniformly here
 * works against both gate types and matches the same bypass LEVIATHAN
 * already uses successfully on the ACP side.
 */
async function squeezeGet(path: string): Promise<unknown> {
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (SML_API_KEY) headers['X-API-Key'] = SML_API_KEY;
  const res = await fetch(`${SQUEEZEOS_BASE}${path}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`SqueezeOS GET ${path}: HTTP ${res.status}`);
  return res.json();
}

async function squeezePost(path: string, body: unknown): Promise<unknown> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };
  if (SML_API_KEY) headers['X-API-Key'] = SML_API_KEY;
  const res = await fetch(`${SQUEEZEOS_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`SqueezeOS POST ${path}: HTTP ${res.status}`);
  return res.json();
}

export const SqueezeOSAPI = {
  // FREE
  preview: (symbol: string) => squeezeGet(`/api/preview/${encodeURIComponent(symbol)}`),
  history: (symbol?: string) => squeezeGet(symbol ? `/api/history/${encodeURIComponent(symbol)}` : '/api/history'),
  /**
   * `/api/oracle/<symbol>` (path segment) runs a fresh, uncached OracleEngine
   * analysis per request server-side and can take 30s+ — that's what caused
   * squeezeos_oracle's timeouts. `/api/oracle` (no segment) serves an
   * instantly-cached full batch. There is no server-side per-symbol filter
   * (a query-string `?symbol=` is silently ignored by the Flask route), so
   * this always fetches the cached batch and filters client-side here —
   * fast and correct, at the cost of the caller getting the whole batch's
   * cache freshness rather than a live single-symbol read.
   */
  oracle: async (symbol?: string): Promise<unknown> => {
    const batch = (await squeezeGet('/api/oracle')) as {
      symbols?: Record<string, unknown>;
      [key: string]: unknown;
    };
    if (!symbol) return batch;
    const upper = symbol.toUpperCase().trim();
    const match = batch?.symbols?.[upper];
    if (!match) {
      return {
        status: 'not_found',
        symbol: upper,
        message: 'Symbol not present in the current cached oracle batch.',
        universe_size: batch?.['universe_size'] ?? null,
      };
    }
    return { status: 'success', symbol: upper, oracle: match, source: 'batch_filtered' };
  },
  ftd: () => squeezeGet('/api/ftd'),
  ftdAlerts: (ticker?: string, minSpikeMultiplier?: number) => {
    const qs = new URLSearchParams();
    if (ticker) qs.set('ticker', ticker);
    if (minSpikeMultiplier !== undefined) qs.set('min_spike_multiplier', String(minSpikeMultiplier));
    const q = qs.toString();
    return squeezeGet(`/api/ftd/alerts${q ? `?${q}` : ''}`);
  },
  status: () => squeezeGet('/api/status'),
  demo: () => squeezeGet('/api/demo'),
  marketplaceBrowse: () => squeezeGet('/api/marketplace'),
  futuresLeaderboard: () => squeezeGet('/api/futures/leaderboard'),
  /**
   * SqueezeOS's real, live Agent Hiring Protocol job board (core/api/hiring_bp.py,
   * `/api/hiring`) — zero-custody, XRPL wallet-to-wallet. Backs nexus_agent_hire's
   * free query tier.
   */
  hiringBrowse: (opts: { jobType?: string; symbol?: string; minBounty?: number } = {}) => {
    const qs = new URLSearchParams();
    if (opts.jobType) qs.set('type', opts.jobType);
    if (opts.symbol) qs.set('symbol', opts.symbol);
    if (opts.minBounty !== undefined) qs.set('min_bounty', String(opts.minBounty));
    const q = qs.toString();
    return squeezeGet(`/api/hiring${q ? `?${q}` : ''}`);
  },

  // PAID — walletAddress is retained in the signature for logging/attribution
  // by callers; auth to SqueezeOS itself is the X-API-Key operator bypass
  // above, not anything derived from the wallet address.
  council: (symbol: string, _walletAddress: string) => squeezePost('/api/council', { symbol }),
  scan: (_walletAddress: string) => squeezeGet('/api/scan'),
  options: (_walletAddress: string) => squeezeGet('/api/options'),
  iwm: (_walletAddress: string) => squeezeGet('/api/iwm'),
  marketplaceRead: (listingId: string, _walletAddress: string) => squeezePost('/api/marketplace/read', { listing_id: listingId }),

  // PAID — FTD series (SEC Reg SHO fails-to-deliver)
  ftdThresholdList: () => squeezeGet('/api/ftd/threshold-list'),
  ftdTimeSeries: (symbol: string, limit?: number) =>
    squeezeGet(`/api/ftd/series/${encodeURIComponent(symbol)}${limit ? `?limit=${limit}` : ''}`),
  ftdRatio: (symbol: string) => squeezeGet(`/api/ftd/ratio/${encodeURIComponent(symbol)}`),
  ftdEtfBasket: (etf: string) => squeezeGet(`/api/ftd/etf-basket/${encodeURIComponent(etf)}`),
  ftdSettlementCycle: (symbol: string) => squeezeGet(`/api/ftd/cycle/${encodeURIComponent(symbol)}`),

  // PAID — CASCADE, IAM, Compliance, Max-Conviction, Content/Wallet Trust
  cascadeSignal: (symbol: string) => squeezePost('/api/cascade/signal', { symbol }),
  iamResolve: (symbol: string) => squeezeGet(`/api/iam/${encodeURIComponent(symbol)}`),
  complianceAnomalyReport: (opts: { bank_id: string; agent_id: string; trigger: string; detail: string; severity?: string }) =>
    squeezePost('/api/compliance/anomaly', opts),
  complianceBankAudit: (bankId: string) => squeezePost('/api/compliance/audit', { bank_id: bankId }),
  complianceRegulatorQuery: (bankId: string) => squeezeGet(`/api/compliance/regulator/query/${encodeURIComponent(bankId)}`),
  maxConvictionSignal: (symbol: string) => squeezePost('/api/triple-lock', { symbol }),
  contentWalletTrustScore: (content: string, senderWallet?: string) =>
    squeezePost('/api/ccs/validate', { content, ...(senderWallet ? { sender_wallet: senderWallet } : {}) }),

  /**
   * Posts a real job to SqueezeOS's Agent Hiring Protocol board. Zero
   * custody — `poster`/`paymentWallet` must be real XRPL wallets (SqueezeOS
   * validates this server-side); the bounty is paid wallet-to-wallet on
   * XRPL once an executor delivers and the poster confirms, entirely
   * outside this gateway. Backs nexus_agent_hire's paid "hire" tier.
   */
  hiringPost: (opts: {
    posterXrplWallet: string;
    description: string;
    bountyRlusd: number;
    jobType?: string;
    symbol?: string;
    requirements?: string;
    deadlineHours?: number;
  }) =>
    squeezePost('/api/hiring/post', {
      wallet: opts.posterXrplWallet,
      job_type: opts.jobType,
      description: opts.description,
      bounty_rlusd: opts.bountyRlusd,
      payment_wallet: opts.posterXrplWallet,
      symbol: opts.symbol,
      requirements: opts.requirements,
      deadline_hours: opts.deadlineHours,
    }),
};
