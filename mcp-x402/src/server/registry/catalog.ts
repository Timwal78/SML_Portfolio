export interface ToolMeta {
  name: string;
  description: string;
  price: string;
  currency: 'USDC' | 'RLUSD';
  freeTier?: string;
  ap2Required: boolean;
  cacheTtl?: number;
}

export const CATALOG: ToolMeta[] = [
  // ── Discovery & Health (FREE) ────────────────────────────────────────────────
  {
    name: 'sml_discover',
    description: 'Complete SML product catalog — all 43 tools, prices, payment instructions. Call this first.',
    price: '0.00',
    currency: 'USDC',
    ap2Required: false,
  },
  {
    name: 'sml_status',
    description: 'Real-time health check of all 8 SML backends. Call before paid requests to avoid wasted payments.',
    price: '0.00',
    currency: 'USDC',
    ap2Required: false,
  },

  // ── 402Proof (FREE) ─────────────────────────────────────────────────────────
  {
    name: 'proof_invoice',
    description: 'Generate x402 payment invoice for any premium endpoint.',
    price: '0.00',
    currency: 'USDC',
    ap2Required: false,
  },
  {
    name: 'proof_verify',
    description: 'Verify an XRPL payment against a 402Proof endpoint.',
    price: '0.00',
    currency: 'USDC',
    ap2Required: false,
  },
  {
    name: 'proof_credit_score',
    description: 'Agent Credit Bureau score lookup (300-850 scale) for any wallet.',
    price: '0.00',
    currency: 'USDC',
    ap2Required: false,
  },

  // ── SqueezeOS — Free Tier ───────────────────────────────────────────────────
  {
    name: 'squeezeos_preview',
    description: 'Bias + regime preview for any ticker. 15-min cache.',
    price: '0.00',
    currency: 'USDC',
    ap2Required: false,
    cacheTtl: 900,
  },
  {
    name: 'squeezeos_history',
    description: 'Per-symbol or all-recent signal history (200-event ring buffer).',
    price: '0.00',
    currency: 'USDC',
    ap2Required: false,
  },
  {
    name: 'squeezeos_oracle',
    description: 'Oracle directive batch — aggregated signal for any ticker or full universe.',
    price: '0.00',
    currency: 'USDC',
    ap2Required: false,
  },
  {
    name: 'squeezeos_ftd',
    description: 'SEC Reg SHO FTD registry snapshot (GME/AMC universe).',
    price: '0.00',
    currency: 'USDC',
    ap2Required: false,
  },
  {
    name: 'squeezeos_status',
    description: 'SqueezeOS system health + uptime.',
    price: '0.00',
    currency: 'USDC',
    ap2Required: false,
  },
  {
    name: 'squeezeos_demo',
    description: 'IWM council demo verdict (5-min cache). No payment required.',
    price: '0.00',
    currency: 'USDC',
    ap2Required: false,
    cacheTtl: 300,
  },
  {
    name: 'squeezeos_marketplace_browse',
    description: 'Browse peer signal marketplace listings.',
    price: '0.00',
    currency: 'USDC',
    ap2Required: false,
  },
  {
    name: 'squeezeos_futures_leaderboard',
    description: 'Top prediction-market stakers on SqueezeOS signal futures.',
    price: '0.00',
    currency: 'USDC',
    ap2Required: false,
  },

  // ── SqueezeOS — Premium (x402 gated) ───────────────────────────────────────
  {
    name: 'squeezeos_council',
    description: 'Multi-engine AI council verdict for any ticker. Highest-fidelity signal on the platform.',
    price: '0.10',
    currency: 'USDC',
    ap2Required: true,
  },
  {
    name: 'squeezeos_scan',
    description: 'Full $1-$50 squeeze scanner across entire universe.',
    price: '0.05',
    currency: 'USDC',
    ap2Required: true,
  },
  {
    name: 'squeezeos_options',
    description: 'Institutional options flow — sweep detection, dark pool prints, GEX levels.',
    price: '0.05',
    currency: 'USDC',
    ap2Required: true,
  },
  {
    name: 'squeezeos_iwm',
    description: 'IWM zero-day-to-expiry contract scorer with gamma wall detection.',
    price: '0.03',
    currency: 'USDC',
    ap2Required: true,
  },
  {
    name: 'squeezeos_marketplace_read',
    description: 'Full signal thesis from a peer marketplace listing.',
    price: '0.02',
    currency: 'USDC',
    ap2Required: false,
  },

  // ── Leviathan Signal ────────────────────────────────────────────────────────
  {
    name: 'leviathan_signal',
    description: 'Institutional-grade squeeze signals. Multi-engine verdict for any ticker.',
    price: '0.05',
    currency: 'USDC',
    ap2Required: true,
  },

  // ── xMIT — SEC EDGAR ────────────────────────────────────────────────────────
  {
    name: 'xmit_edgar_decode',
    description: 'Parse SEC DEF 14A / 13F / 13D filings. Raw text never leaves SML servers.',
    price: '0.02',
    currency: 'USDC',
    ap2Required: true,
  },

  // ── xDEO — Earnings Oracle ──────────────────────────────────────────────────
  {
    name: 'xdeo_earnings_estimate',
    description: 'Decentralized earnings oracle. +2 bureau_score on success.',
    price: '0.02',
    currency: 'USDC',
    ap2Required: true,
  },

  // ── FTD Scanner ─────────────────────────────────────────────────────────────
  {
    name: 'ftd_threshold_scan',
    description: 'SEC Reg SHO FTD data. Alerts free; full scan + spike history 0.05 USDC.',
    price: '0.05',
    currency: 'USDC',
    ap2Required: false,
    freeTier: 'alerts_only',
    cacheTtl: 900,
  },

  // ── Nexus Agent Marketplace ─────────────────────────────────────────────────
  {
    name: 'nexus_agent_hire',
    description: 'Agent job board. Query free; hire charges 5% commission on agent fee.',
    price: '0.00',
    currency: 'USDC',
    ap2Required: false,
    freeTier: 'query_only',
  },

  // ── Crawl ───────────────────────────────────────────────────────────────────
  {
    name: 'crawl_paid_fetch',
    description: 'Pay-per-fetch web scraping. Agents pay $0.005; humans bypass free.',
    price: '0.005',
    currency: 'USDC',
    ap2Required: false,
  },

  // ── Echo — Pattern Match ────────────────────────────────────────────────────
  {
    name: 'echo_pattern_match',
    description: 'Historical price pattern matching via Echo Forge — find analogues across 10 years of market data.',
    price: '0.03',
    currency: 'USDC',
    ap2Required: false,
  },

  // ── AgentCard ───────────────────────────────────────────────────────────────
  {
    name: 'agentcard_lookup',
    description: 'Lookup an agent\'s Ed25519 signed identity card and capability manifest.',
    price: '0.00',
    currency: 'USDC',
    ap2Required: false,
  },
  {
    name: 'agentcard_verify',
    description: 'Cryptographically verify an agent card signature.',
    price: '0.00',
    currency: 'USDC',
    ap2Required: false,
  },
  {
    name: 'agentcard_mint',
    description: 'Mint and register a new agent identity card with Ed25519 signing key.',
    price: '0.01',
    currency: 'USDC',
    ap2Required: false,
  },

  // ── Ghost Layer ─────────────────────────────────────────────────────────────
  {
    name: 'ghost_status',
    description: 'Ghost Layer routing engine health and active channel status.',
    price: '0.00',
    currency: 'USDC',
    ap2Required: false,
  },
  {
    name: 'ghost_route',
    description: 'Private cross-chain routing: XRPL ↔ Base. ZK-shielded toll gateway.',
    price: '0.01',
    currency: 'USDC',
    ap2Required: false,
  },

  // ── RLUSD Rails ─────────────────────────────────────────────────────────────
  {
    name: 'rails_status',
    description: 'RLUSD Rails health — XRPL and Xahau remittance engine status.',
    price: '0.00',
    currency: 'USDC',
    ap2Required: false,
  },
  {
    name: 'rails_transfer',
    description: 'Initiate RLUSD remittance on XRPL or Xahau. AP2 compliance built-in.',
    price: '0.01',
    currency: 'RLUSD',
    ap2Required: true,
  },

  // ── Shadow Desk ─────────────────────────────────────────────────────────────
  {
    name: 'shadow_query',
    description: 'Query Shadow Desk signal intelligence — institutional dark-pool and block-trade feed.',
    price: '0.02',
    currency: 'USDC',
    ap2Required: true,
  },
  {
    name: 'shadow_ingest',
    description: 'Submit raw market intelligence to the Shadow Desk network (operator-only).',
    price: '0.00',
    currency: 'USDC',
    ap2Required: false,
    freeTier: 'operator_only',
  },

  // ── Forge x402 Gateway ──────────────────────────────────────────────────────
  {
    name: 'forge_status',
    description: 'Forge x402 LLM gateway health and supported model list.',
    price: '0.00',
    currency: 'USDC',
    ap2Required: false,
  },
  {
    name: 'forge_llm',
    description: 'BYOK LLM proxy via Forge x402 gateway — pay-per-token with USDC on Base.',
    price: '0.01',
    currency: 'USDC',
    ap2Required: false,
  },

  // ── XRPL Copy-Trader ────────────────────────────────────────────────────────
  {
    name: 'copytrader_status',
    description: 'Copy-Trader engine health and active whale positions being tracked.',
    price: '0.00',
    currency: 'USDC',
    ap2Required: false,
  },
  {
    name: 'copytrader_whales',
    description: 'Live XRPL whale wallet feed — top position holders ranked by volume.',
    price: '0.03',
    currency: 'USDC',
    ap2Required: false,
  },
  {
    name: 'copytrader_subscribe',
    description: 'Subscribe to copy-trade a whale wallet. Positions mirror automatically.',
    price: '0.05',
    currency: 'USDC',
    ap2Required: true,
  },

  // ── Memecoin Launchpad ──────────────────────────────────────────────────────
  {
    name: 'launchpad_status',
    description: 'Memecoin Launchpad status — active bonding curves and launch queue.',
    price: '0.00',
    currency: 'USDC',
    ap2Required: false,
  },
  {
    name: 'launchpad_list',
    description: 'Browse all active memecoin launches on the XRPL bonding curve launchpad.',
    price: '0.00',
    currency: 'USDC',
    ap2Required: false,
  },
  {
    name: 'launchpad_create',
    description: 'Deploy a new memecoin on the XRPL bonding curve launchpad.',
    price: '0.10',
    currency: 'RLUSD',
    ap2Required: true,
  },
  {
    name: 'launchpad_buy',
    description: 'Buy tokens from an active bonding curve launch via x402.',
    price: '0.00',
    currency: 'RLUSD',
    ap2Required: false,
    freeTier: 'price_from_bonding_curve',
  },
];

export function getToolMeta(name: string): ToolMeta | undefined {
  return CATALOG.find((t) => t.name === name);
}
