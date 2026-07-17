/**
 * APM capability index — the real, curated map of what each LIVE SML tool can do,
 * how fresh its data is, which payment chains it settles on, and what it costs.
 *
 * Prices mirror src/server/registry/pricing.ts (BASE_PRICES). `product` MUST match a
 * product key in src/server/registry/backends.ts so live-status can be resolved.
 *
 * This is the matchable surface APM negotiates against — not a simulation.
 */

export interface Capability {
  /** MCP tool name an agent would ultimately call. */
  tool: string;
  /** Backend product key (must match backends.ts `product`). */
  product: string;
  /** True if calling the tool costs USDC. */
  paid: boolean;
  /** Base price in USDC (string, '0.00' for free tools). */
  basePrice: string;
  /** Payment chains this tool settles on. Data tools accept all three. */
  paymentChains: string[];
  /** Worst-case data staleness in seconds (0 = live/realtime). */
  freshnessSec: number;
  /** True if the tool cites authoritative sources (e.g. SEC filings). */
  attribution: boolean;
  /** Match keywords. */
  tags: string[];
  /** One-line description. */
  summary: string;
}

const ALL_CHAINS = ['base', 'xrpl', 'solana'];

export const CAPABILITIES: Capability[] = [
  // ── SqueezeOS (squeezeos-api.onrender.com) ────────────────────────────────
  {
    tool: 'squeezeos_council', product: 'SqueezeOS', paid: true, basePrice: '0.10',
    paymentChains: ALL_CHAINS, freshnessSec: 60, attribution: false,
    tags: ['squeeze', 'signal', 'equity', 'equities', 'stock', 'stocks', 'ticker', 'council', 'verdict', 'momentum', 'trading', 'ai', 'confidence'],
    summary: 'Multi-engine AI council verdict for any symbol — highest-confidence squeeze signal.',
  },
  {
    tool: 'squeezeos_scan', product: 'SqueezeOS', paid: true, basePrice: '0.05',
    paymentChains: ALL_CHAINS, freshnessSec: 300, attribution: false,
    tags: ['scan', 'screener', 'candidates', 'squeeze', 'list', 'stocks', 'ranked', 'discover'],
    summary: 'Full $1–$50 squeeze candidate scanner — ranked by squeeze score.',
  },
  {
    tool: 'squeezeos_options', product: 'SqueezeOS', paid: true, basePrice: '0.05',
    paymentChains: ALL_CHAINS, freshnessSec: 60, attribution: false,
    tags: ['options', 'flow', 'darkpool', 'sweep', 'greeks', 'derivatives', 'unusual'],
    summary: 'Institutional options flow analysis — dark pool and sweep detection.',
  },
  {
    tool: 'squeezeos_iwm', product: 'SqueezeOS', paid: true, basePrice: '0.03',
    paymentChains: ALL_CHAINS, freshnessSec: 5, attribution: false,
    tags: ['iwm', '0dte', 'options', 'greeks', 'realtime', 'index', 'russell', 'probability'],
    summary: 'IWM 0DTE contract scorer — real-time Greeks and probability.',
  },
  {
    tool: 'squeezeos_preview', product: 'SqueezeOS', paid: false, basePrice: '0.00',
    paymentChains: ALL_CHAINS, freshnessSec: 900, attribution: false,
    tags: ['preview', 'bias', 'signal', 'free', 'ticker', 'sample'],
    summary: 'Free signal bias preview for any ticker (15-min cache).',
  },
  {
    tool: 'squeezeos_oracle', product: 'SqueezeOS', paid: false, basePrice: '0.00',
    paymentChains: ALL_CHAINS, freshnessSec: 5, attribution: false,
    tags: ['oracle', 'directive', 'signal', 'aggregate', 'free', 'fractal'],
    summary: 'Free oracle directive — aggregated signal across all engines.',
  },

  // ── Core SML Intelligence (served by squeezeos-api) ───────────────────────
  {
    tool: 'leviathan_signal', product: 'SqueezeOS', paid: true, basePrice: '0.05',
    paymentChains: ALL_CHAINS, freshnessSec: 60, attribution: false,
    tags: ['squeeze', 'signal', 'institutional', 'verdict', 'ticker', 'momentum', 'leviathan', 'proprietary'],
    summary: 'Institutional squeeze signals — proprietary multi-engine verdict for any ticker.',
  },
  {
    tool: 'xmit_edgar_decode', product: 'SqueezeOS', paid: true, basePrice: '0.02',
    paymentChains: ALL_CHAINS, freshnessSec: 86400, attribution: true,
    tags: ['sec', 'edgar', 'filing', 'filings', '13f', '13d', 'def14a', 'parse', 'proxy', 'institutional', 'holdings'],
    summary: 'Parse SEC DEF 14A / 13F / 13D filings — raw text never leaves SML servers.',
  },
  {
    tool: 'xdeo_earnings_estimate', product: 'SqueezeOS', paid: true, basePrice: '0.02',
    paymentChains: ALL_CHAINS, freshnessSec: 3600, attribution: true,
    tags: ['earnings', 'estimate', 'oracle', 'consensus', 'eps', 'finance', 'forecast'],
    summary: 'Decentralized earnings oracle — consensus estimate across data sources.',
  },
  {
    tool: 'ftd_threshold_scan', product: 'SqueezeOS', paid: false, basePrice: '0.05',
    paymentChains: ALL_CHAINS, freshnessSec: 900, attribution: true,
    tags: ['ftd', 'fail', 'deliver', 'regsho', 'threshold', 'sec', 'short', 'naked'],
    summary: 'SEC Reg SHO FTD data — threshold alerts free, full scanner $0.05.',
  },
  {
    tool: 'crawl_paid_fetch', product: 'SqueezeOS', paid: true, basePrice: '0.005',
    paymentChains: ALL_CHAINS, freshnessSec: 0, attribution: false,
    tags: ['crawl', 'scrape', 'fetch', 'web', 'url', 'page', 'data', 'http'],
    summary: 'Pay-per-fetch web scraping for AI agents ($0.005/fetch).',
  },
  {
    tool: 'nexus_agent_hire', product: 'SqueezeOS', paid: false, basePrice: '0.00',
    paymentChains: ALL_CHAINS, freshnessSec: 0, attribution: false,
    tags: ['agent', 'hire', 'marketplace', 'job', 'delegate', 'a2a', 'workforce'],
    summary: 'Agent job marketplace — browse free, hire charges 5% commission.',
  },

  // ── Ghost Layer (cross-chain settlement) ──────────────────────────────────
  {
    tool: 'ghost_route', product: 'Ghost Layer', paid: true, basePrice: '0.01',
    paymentChains: ['xrpl', 'base'], freshnessSec: 0, attribution: false,
    tags: ['route', 'cross-chain', 'crosschain', 'bridge', 'settlement', 'xrpl', 'base', 'toll', 'transfer', 'private'],
    summary: 'Route a transaction through the dual-chain XRPL+Base gateway with toll collection.',
  },

  // ── 402Proof (payment + trust) ────────────────────────────────────────────
  {
    tool: 'proof_invoice', product: '402Proof', paid: false, basePrice: '0.00',
    paymentChains: ALL_CHAINS, freshnessSec: 0, attribution: false,
    tags: ['invoice', 'x402', 'payment', 'bill', 'quote', 'pay'],
    summary: 'Generate an x402 payment invoice for any SML endpoint.',
  },
  {
    tool: 'proof_verify', product: '402Proof', paid: false, basePrice: '0.00',
    paymentChains: ALL_CHAINS, freshnessSec: 0, attribution: false,
    tags: ['verify', 'payment', 'tx', 'receipt', 'confirm', 'settlement'],
    summary: 'Verify an XRPL or Base payment tx_hash — returns receipt and confirmation.',
  },
  {
    tool: 'proof_credit_score', product: '402Proof', paid: false, basePrice: '0.00',
    paymentChains: ALL_CHAINS, freshnessSec: 0, attribution: false,
    tags: ['credit', 'score', 'reputation', 'bureau', 'trust', 'history', 'identity'],
    summary: 'Get an agent credit score (300–850) and payment history by wallet.',
  },

  // ── RLUSD Rails (XRPL/Xahau settlement) ───────────────────────────────────
  {
    tool: 'rails_transfer', product: 'RLUSD Rails', paid: true, basePrice: '0.01',
    paymentChains: ['xrpl'], freshnessSec: 0, attribution: false,
    tags: ['rlusd', 'xrp', 'transfer', 'remittance', 'payment', 'settlement', 'xrpl', 'xahau', 'send'],
    summary: 'Initiate an RLUSD or XRP transfer via SML Rails — returns tx_hash.',
  },

  // ── XRPL Copy-Trader ──────────────────────────────────────────────────────
  {
    tool: 'copytrader_subscribe', product: 'Copy-Trader', paid: true, basePrice: '0.05',
    paymentChains: ['xrpl'], freshnessSec: 60, attribution: false,
    tags: ['whale', 'copy', 'mirror', 'trade', 'xrpl', 'follow', 'position'],
    summary: 'Subscribe to mirror a whale wallet — auto-copies future positions.',
  },

  // ── Memecoin Launchpad ────────────────────────────────────────────────────
  {
    tool: 'launchpad_create', product: 'Launchpad', paid: true, basePrice: '0.10',
    paymentChains: ['xrpl'], freshnessSec: 0, attribution: false,
    tags: ['memecoin', 'token', 'launch', 'create', 'bonding', 'curve', 'xrpl', 'mint'],
    summary: 'Create a new memecoin with a bonding curve — supply, curve, metadata.',
  },
  {
    tool: 'launchpad_buy', product: 'Launchpad', paid: true, basePrice: '0.01',
    paymentChains: ['xrpl'], freshnessSec: 5, attribution: false,
    tags: ['memecoin', 'token', 'buy', 'bonding', 'curve', 'xrpl', 'trade'],
    summary: 'Buy tokens on a memecoin bonding curve — returns executed price and tx.',
  },

  // ── Shadow Desk (alpha intelligence) ──────────────────────────────────────
  {
    tool: 'shadow_query', product: 'Shadow Desk', paid: true, basePrice: '0.02',
    paymentChains: ALL_CHAINS, freshnessSec: 300, attribution: false,
    tags: ['alpha', 'signal', 'intelligence', 'feed', 'query', 'shadow', 'edge'],
    summary: 'Query signal intelligence from the Shadow Desk alpha feed.',
  },

  // ── Forge Gateway (BYOK LLM proxy) ────────────────────────────────────────
  {
    tool: 'forge_llm', product: 'Forge Gateway', paid: true, basePrice: '0.02',
    paymentChains: ALL_CHAINS, freshnessSec: 0, attribution: false,
    tags: ['llm', 'ai', 'model', 'inference', 'completion', 'byok', 'proxy', 'gpt', 'claude'],
    summary: 'BYOK LLM proxy — call any AI model, pay per request via x402.',
  },
];
