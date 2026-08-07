/**
 * amb-generator.ts — Agent Magnet Beacon (AMB) v0.1.0
 *
 * Multi-rail payTo is ALWAYS the ACP EOA:
 *   EVM (Base USDC + RH USDG): 0x72330994f379a71542e7bd5a4cf99a9d9743f4aa
 *   Solana USDC:               E4d3JwcTjeqTRkkQS4moszcfa4R7G1NMgPSew4KBNFrB
 *   XRPL RLUSD:                rNduuviQ3CCvHqWUTjJDD82Ko2tjqFGs3q
 *
 * NEVER use orphan 0x4e14… as payTo.
 */
import { createHash } from 'node:crypto';
import { scoreToolImp, type ImpScoreResult } from './imp-scoring.js';

export const AMB_VERSION = '0.1.0';
export const ACP_PAY_TO =
  process.env['SML_PAYMENT_RECEIVER']?.trim() ||
  process.env['X402_PAY_TO']?.trim() ||
  '0x72330994f379a71542e7bd5a4cf99a9d9743f4aa';

// Refuse orphan seed if env ever points there
export const SAFE_PAY_TO = ACP_PAY_TO.toLowerCase().startsWith('0x4e14')
  ? '0x72330994f379a71542e7bd5a4cf99a9d9743f4aa'
  : ACP_PAY_TO;

export const SOL_PAY_TO =
  process.env['SOLANA_PAYMENT_RECEIVER']?.trim() ||
  process.env['SOLANA_PAY_TO']?.trim() ||
  'E4d3JwcTjeqTRkkQS4moszcfa4R7G1NMgPSew4KBNFrB';

export const XRPL_PAY_TO =
  process.env['XRPL_PAYMENT_RECEIVER']?.trim() ||
  process.env['XRPL_PAY_TO']?.trim() ||
  'rNduuviQ3CCvHqWUTjJDD82Ko2tjqFGs3q';

export const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const USDG_ASSET = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
export const SOL_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const RLUSD_ISSUER = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De';

/** Canonical multi-rail set for ScriptMasterLabs (chat #14/#15 + live hosts) */
export const MULTI_RAILS = [
  'base_usdc',
  'base_usdg', // alias of robinhood_usdg / USCG
  'robinhood_usdg',
  'solana_usdc',
  'xrpl_rlusd',
] as const;

export type RailId = (typeof MULTI_RAILS)[number] | string;

export interface AMBInput {
  toolName: string;
  namespace: string;
  endpoint: string;
  /** EVM payTo — MUST be ACP 0x7233… */
  payTo?: string;
  price: string;
  currency?: string;
  rails?: RailId[];
  avgLatencyMs: number;
  successRate24h: number;
  uptime24h: number;
  reputationScore: number;
  settlements?: number;
  freeTier?: boolean;
  description?: string;
  capabilities?: string[];
  ttlMinutes?: number;
}

export interface AgentMagnetBeacon {
  amb_version: string;
  type: 'AgentMagnetBeacon';
  id: string;
  issuer: string;
  agent: {
    name: string;
    id: string;
    wallet: string;
    marketplace: string;
  };
  issued_at: number;
  expires_at: number;
  namespace: string;
  endpoint: string;
  tool_name: string;
  payment: {
    rails: string[];
    price: string;
    currency: string;
    x402: boolean;
    pay_to: string;
    payToByNetwork: Record<string, string>;
    assetsByNetwork: Record<string, string>;
    asset: string;
    rail_detail: Array<Record<string, unknown>>;
    rail_details?: Record<string, { price?: string; pay_to?: string }>;
  };
  performance: {
    avg_latency_ms: number;
    success_rate_24h: number;
    uptime_24h: number;
  };
  reputation: {
    score: number;
    settlements: number;
    source: string;
  };
  magnet_strength: number;
  /** IMP v0.1 multi-rail composite — primary rank key for list_magnets */
  imp_score: number;
  rail_score: number;
  rail_coverage: number;
  imp_version: string;
  imp?: Pick<ImpScoreResult, 'stale' | 'orphan_refused' | 'formula' | 'healthy_rails' | 'total_rails'>;
  capabilities: string[];
  free_tier: boolean;
  description: string;
  signature: string;
  links: Record<string, string>;
}

export function magnetStrength(
  reputationScore = 0.94,
  successRate24h = 0.987,
  uptime24h = 0.999,
  avgLatencyMs = 420,
): number {
  const latTerm = 1 / Math.log10(avgLatencyMs + 10);
  const raw =
    reputationScore * 0.5 +
    successRate24h * 0.25 +
    uptime24h * 0.15 +
    latTerm * 0.1;
  return Math.max(0, Math.min(1, Math.round(raw * 10000) / 10000));
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function beaconId(core: {
  tool_name: string;
  endpoint: string;
  issuer: string;
  pay_to: string;
  price: string;
  issued_at: number;
}): string {
  const blob = `${core.tool_name}|${core.endpoint}|${core.issuer}|${core.pay_to}|${core.price}|${core.issued_at}`;
  return `sha256:${sha256Hex(blob)}`;
}

/** Deterministic 0x-hex placeholder until AgentCard signer is attached. */
function unsignedSig(id: string, toolName: string, issuedAt: number, payTo: string): string {
  return `0x${sha256Hex(`${id}|${toolName}|${issuedAt}|${payTo}|amb0.1`)}`;
}

function normalizePayTo(payTo?: string): string {
  const p = (payTo || SAFE_PAY_TO).trim();
  if (p.toLowerCase().startsWith('0x4e14')) return SAFE_PAY_TO;
  return p;
}

export function buildPaymentBlock(payTo: string, price: string, freeTier: boolean, rails?: RailId[]) {
  const evm = normalizePayTo(payTo);
  const railList = rails?.length ? [...rails] : [...MULTI_RAILS];
  // Dedup while keeping order
  const seen = new Set<string>();
  const railsOut = railList.filter((r) => {
    if (seen.has(r)) return false;
    seen.add(r);
    return true;
  });

  return {
    rails: railsOut,
    price: String(price),
    currency: 'USDC',
    x402: !freeTier,
    pay_to: evm,
    payToByNetwork: {
      'eip155:8453': evm,
      base: evm,
      'eip155:4663': evm,
      robinhood: evm,
      'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': SOL_PAY_TO,
      solana: SOL_PAY_TO,
      'solana-mainnet': SOL_PAY_TO,
      xrpl: XRPL_PAY_TO,
      'xrpl:0': XRPL_PAY_TO,
    },
    assetsByNetwork: {
      'eip155:8453': BASE_USDC,
      'eip155:4663': USDG_ASSET,
      'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': SOL_USDC_MINT,
      xrpl: 'RLUSD',
    },
    asset: BASE_USDC,
    rail_detail: [
      {
        id: 'base_usdc',
        symbol: 'USDC',
        network: 'eip155:8453',
        payTo: evm,
        asset: BASE_USDC,
        primary: true,
      },
      {
        id: 'base_usdg',
        symbol: 'USDG',
        aliases: ['USCG', 'robinhood_usdg'],
        network: 'eip155:4663',
        payTo: evm,
        asset: USDG_ASSET,
      },
      {
        id: 'robinhood_usdg',
        symbol: 'USDG',
        aliases: ['USCG', 'base_usdg'],
        network: 'eip155:4663',
        payTo: evm,
        asset: USDG_ASSET,
      },
      {
        id: 'solana_usdc',
        symbol: 'USDC',
        network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        payTo: SOL_PAY_TO,
        asset: SOL_USDC_MINT,
      },
      {
        id: 'xrpl_rlusd',
        symbol: 'RLUSD',
        network: 'xrpl',
        payTo: XRPL_PAY_TO,
        asset: 'RLUSD',
        issuer: RLUSD_ISSUER,
      },
    ],
  };
}

export function generateAMB(
  input: AMBInput,
  issuerDid?: string,
  _privateKeyPem?: string,
): AgentMagnetBeacon {
  const payTo = normalizePayTo(input.payTo);
  const issuer =
    issuerDid ||
    process.env['AMB_ISSUER_DID'] ||
    `did:agentcard:scriptmasterlabs:${payTo}`;
  const now = Date.now();
  const ttlMs = (input.ttlMinutes ?? 15) * 60 * 1000;
  const freeTier = Boolean(input.freeTier);
  const price = freeTier ? '0' : String(input.price || '0.001');
  const payment = buildPaymentBlock(payTo, price, freeTier, input.rails);
  const imp = scoreToolImp({
    tool: input.toolName,
    reputation: input.reputationScore,
    successRate24h: input.successRate24h,
    uptime24h: input.uptime24h,
    avgLatencyMs: input.avgLatencyMs,
    price: freeTier ? '0' : String(input.price || '0.001'),
    payTo,
    freeTier,
    advertisedRails: (input.rails as string[] | undefined) || [
      'base_usdc',
      'base_usdg',
      'solana_usdc',
      'xrpl_rlusd',
    ],
    issuedAtMs: now,
    ttlMs,
  });
  const strength = imp.magnet_strength;
  const id = beaconId({
    tool_name: input.toolName,
    endpoint: input.endpoint,
    issuer,
    pay_to: payTo,
    price,
    issued_at: now,
  });

  return {
    amb_version: AMB_VERSION,
    type: 'AgentMagnetBeacon',
    id,
    issuer,
    agent: {
      name: 'scriptmasterlabs',
      id: process.env['ACP_AGENT_ID'] || '019f5f40-c194-7776-b5e1-7a666ce631c0',
      wallet: payTo,
      marketplace: 'Virtuals ACP',
    },
    issued_at: now,
    expires_at: now + ttlMs,
    namespace: input.namespace,
    endpoint: input.endpoint,
    tool_name: input.toolName,
    payment,
    performance: {
      avg_latency_ms: input.avgLatencyMs,
      success_rate_24h: input.successRate24h,
      uptime_24h: input.uptime24h,
    },
    reputation: {
      score: input.reputationScore,
      settlements: input.settlements ?? 0,
      source: '402Proof',
    },
    magnet_strength: strength,
    imp_score: imp.imp_score,
    rail_score: imp.rail_score,
    rail_coverage: imp.rail_coverage,
    imp_version: imp.imp_version,
    imp: {
      stale: imp.stale,
      orphan_refused: imp.orphan_refused,
      formula: imp.formula,
      healthy_rails: imp.healthy_rails,
      total_rails: imp.total_rails,
    },
    capabilities: input.capabilities?.length ? input.capabilities : [input.toolName],
    free_tier: freeTier,
    description:
      input.description ||
      `${input.toolName} — ScriptMasterLabs multi-rail x402 (USDC/USDG/SOL/RLUSD).`,
    signature: unsignedSig(id, input.toolName, now, payTo),
    links: {
      x402: 'https://mcp-x402.onrender.com/.well-known/x402',
      amb: 'https://mcp-x402.onrender.com/.well-known/amb.json',
      agent_card: 'https://mcp-x402.onrender.com/.well-known/agent.json',
      mcp: 'https://mcp-x402.onrender.com/mcp',
      homepage: 'https://www.scriptmasterlabs.com',
      acp: 'https://acp-x402-scriptmasterlabs.onrender.com/.well-known/amb.json',
    },
  };
}

export function exampleSqueezeScannerBeacon(privateKeyPem?: string): AgentMagnetBeacon {
  return generateAMB(
    {
      toolName: 'squeeze_scanner',
      namespace: 'Finance.TradingIntelligence.SqueezeOS',
      endpoint: 'https://mcp-x402.onrender.com/mcp',
      payTo: SAFE_PAY_TO,
      price: '0.001',
      currency: 'USDC',
      rails: ['base_usdc', 'base_usdg', 'solana_usdc', 'xrpl_rlusd'],
      avgLatencyMs: 420,
      successRate24h: 0.987,
      uptime24h: 0.999,
      reputationScore: 0.94,
      settlements: 12470,
      freeTier: false,
      description:
        'Institutional squeeze scanner + multi-engine AI council. Multi-rail x402 (USDC/USDG/SOL/RLUSD).',
      capabilities: ['squeeze_scanner', 'options_flow', 'ftd_registry'],
    },
    `did:agentcard:scriptmasterlabs:${SAFE_PAY_TO}`,
    privateKeyPem,
  );
}

/** Default live tool set advertised as magnets on mcp-x402 */
export function defaultMagnetCatalog(): AMBInput[] {
  const base = process.env['PUBLIC_BASE_URL'] || 'https://mcp-x402.onrender.com';
  const mcp = `${base}/mcp`;
  const common = {
    payTo: SAFE_PAY_TO,
    rails: ['base_usdc', 'base_usdg', 'solana_usdc', 'xrpl_rlusd'] as string[],
    avgLatencyMs: 420,
    successRate24h: 0.987,
    uptime24h: 0.999,
    reputationScore: 0.94,
    settlements: Number(process.env['AMB_SETTLEMENTS'] || '0'),
  };
  return [
    {
      ...common,
      toolName: 'list_magnets',
      namespace: 'Agent.Discovery.AMB',
      endpoint: `${base}/.well-known/amb.json`,
      price: '0',
      freeTier: true,
      avgLatencyMs: 40,
      successRate24h: 1,
      uptime24h: 1,
      reputationScore: 1,
      description: 'FREE — list Agent Magnet Beacons ranked by IMP imp_score (multi-rail).',
      capabilities: ['amb', 'discovery', 'list_magnets'],
    },
    {
      ...common,
      toolName: 'sml_discover',
      namespace: 'Agent.Discovery',
      endpoint: mcp,
      price: '0',
      freeTier: true,
      description: 'FREE catalog of all ScriptMasterLabs MCP tools + prices.',
      capabilities: ['sml_discover', 'discovery'],
    },
    {
      ...common,
      toolName: 'squeeze_scanner',
      namespace: 'Finance.TradingIntelligence.SqueezeOS',
      endpoint: mcp,
      price: '0.001',
      description: 'Institutional squeeze scanner + multi-engine AI council.',
      capabilities: ['squeeze_scanner', 'squeezeos_scan', 'options_flow'],
    },
    {
      ...common,
      toolName: 'squeezeos_council',
      namespace: 'Finance.TradingIntelligence.SqueezeOS',
      endpoint: mcp,
      price: '0.02',
      description: 'Multi-engine AI council verdict for equities.',
      capabilities: ['squeezeos_council'],
    },
    {
      ...common,
      toolName: 'options_flow',
      namespace: 'Finance.TradingIntelligence.Options',
      endpoint: mcp,
      price: '0.001',
      description: 'Options flow / unusual activity intelligence.',
      capabilities: ['options_flow', 'squeezeos_options'],
    },
    {
      ...common,
      toolName: 'gas_tracker',
      namespace: 'Crypto.Onchain.Gas',
      endpoint: `${base}/x402/gas-tracker`,
      price: '0.001',
      description: 'Live gas tracker snack — $0.001 multi-rail x402.',
      capabilities: ['gas_tracker'],
    },
    {
      ...common,
      toolName: 'crypto_token_price',
      namespace: 'Crypto.Market.Data',
      endpoint: mcp,
      price: '0.001',
      description: 'Real-time token price / mcap / 24h change.',
      capabilities: ['crypto_token_price'],
    },
    {
      ...common,
      toolName: 'fx_exchange_rate',
      namespace: 'Finance.FX',
      endpoint: mcp,
      price: '0.001',
      description: 'Central-bank FX rates — 201 currencies.',
      capabilities: ['fx_exchange_rate'],
    },
    {
      ...common,
      toolName: 'search_grants',
      namespace: 'Gov.Federal.Grants',
      endpoint: mcp,
      price: '0.001',
      description: 'Federal grants search (Grants.gov).',
      capabilities: ['search_grants'],
    },
    {
      ...common,
      toolName: 'search_contracts',
      namespace: 'Gov.Federal.SAM',
      endpoint: mcp,
      price: '0.001',
      description: 'SAM.gov contract opportunities + set-asides.',
      capabilities: ['search_contracts', 'sdvosb'],
    },
    {
      ...common,
      toolName: 'rwa_intelligence',
      namespace: 'Finance.RWA.Intelligence',
      endpoint: mcp,
      price: '0.001',
      description: 'RWA intelligence aggregates.',
      capabilities: ['rwa_intelligence'],
    },
  ];
}

export function buildAmbDocument(baseUrl?: string): {
  amb_version: string;
  type: 'AgentMagnetBeaconSet';
  issuer: string;
  agent: Record<string, unknown>;
  issued_at: number;
  expires_at: number;
  pay_to: string;
  rails: string[];
  count: number;
  paid_count: number;
  free_count: number;
  top_magnet: Record<string, unknown> | null;
  formula: string;
  imp_version: string;
  ranking: string;
  discovery: Record<string, string>;
  beacons: AgentMagnetBeacon[];
  note: string;
} {
  const base = (baseUrl || process.env['PUBLIC_BASE_URL'] || 'https://mcp-x402.onrender.com').replace(
    /\/$/,
    '',
  );
  const issuer = `did:agentcard:scriptmasterlabs:${SAFE_PAY_TO}`;
  const catalog = defaultMagnetCatalog().map((t) => {
    // rewrite endpoints to this host when possible
    if (t.endpoint.includes('mcp-x402.onrender.com') && base !== 'https://mcp-x402.onrender.com') {
      return {
        ...t,
        endpoint: t.endpoint.replace('https://mcp-x402.onrender.com', base),
      };
    }
    return t;
  });
  const beacons = catalog.map((t) => generateAMB(t, issuer));
  const free = beacons.filter((b) => b.free_tier);
  const paid = beacons.filter((b) => !b.free_tier).sort((a, b) => (b.imp_score ?? b.magnet_strength) - (a.imp_score ?? a.magnet_strength));
  const ordered = [...free, ...paid];
  const top = paid[0] || null;
  const now = Date.now();
  return {
    amb_version: AMB_VERSION,
    type: 'AgentMagnetBeaconSet',
    issuer,
    agent: {
      name: 'scriptmasterlabs',
      id: process.env['ACP_AGENT_ID'] || '019f5f40-c194-7776-b5e1-7a666ce631c0',
      wallet: SAFE_PAY_TO,
      role: 'HYBRID',
      marketplace: 'Virtuals ACP',
    },
    issued_at: now,
    expires_at: now + 15 * 60 * 1000,
    pay_to: SAFE_PAY_TO,
    rails: [...MULTI_RAILS],
    count: ordered.length,
    paid_count: paid.length,
    free_count: free.length,
    top_magnet: top
      ? {
          tool_name: top.tool_name,
          magnet_strength: top.magnet_strength,
          imp_score: top.imp_score,
          rail_score: top.rail_score,
          rail_coverage: top.rail_coverage,
          endpoint: top.endpoint,
          price: top.payment.price,
        }
      : null,
    formula:
      'imp_score = magnet*0.70 + rail_score*0.20 + rail_coverage*0.10; magnet = rep*0.50 + success*0.25 + uptime*0.15 + lat_term*0.10 (IMP v0.1)',
    imp_version: '0.1.0',
    ranking: 'list_magnets ranks by imp_score (fallback magnet_strength); free beacons listed first',
    discovery: {
      amb: `${base}/.well-known/amb.json`,
      agent: `${base}/.well-known/agent.json`,
      x402: `${base}/.well-known/x402`,
      mcp: `${base}/mcp`,
      www: 'https://www.scriptmasterlabs.com/.well-known/amb.json',
      acp: 'https://acp-x402-scriptmasterlabs.onrender.com/.well-known/amb.json',
    },
    beacons: ordered,
    note:
      'Prefer highest imp_score (IMP v0.1 multi-rail). magnet_strength kept for scanners. Multi-rail x402: Base USDC, RH USDG, Sol USDC, XRPL RLUSD. pay_to ACP EOA 0x7233 — never orphan 0x4e14.',
  };
}
