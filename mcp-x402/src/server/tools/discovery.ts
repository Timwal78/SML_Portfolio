import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AuditLogger } from '../security/audit.js';
import { BACKENDS, checkBackends } from '../registry/backends.js';

const CATALOG = {
  version: '2.0.0',
  description: 'ScriptMasterLabs unified MCP gateway — the Amazon for agentic payrails. One endpoint, every SML product, autonomous x402 payments.',
  quickstart: 'Call sml_discover first (free). Call sml_status to check backend health. Then call any tool — free tools need no payment, paid tools auto-collect via x402.',
  payment: {
    protocol: 'x402',
    chains: ['base (USDC — preferred, <3s)', 'xrpl (RLUSD)', 'solana (USDC — fallback)'],
    daily_cap_usd: 50,
    auto_approve_under_usd: 1.00,
    min_credit_score: 300,
    credit_bureau: 'https://four02proof.onrender.com/v1/score',
    price_cache_seconds: 60,
  },
  products: [
    {
      product: 'Federal Data',
      description: 'Live federal grant and contract intelligence — Grants.gov + SAM.gov, set-aside aware (SDVOSB, 8(a), WOSB, HUBZone)',
      backend: 'https://api.grants.gov + https://api.sam.gov',
      tools: [
        { name: 'search_grants',    type: 'PAID', price_usdc: '0.02', description: 'Search federal grant opportunities via Grants.gov Search2 — keyword, agency, CFDA, status' },
        { name: 'search_contracts', type: 'PAID', price_usdc: '0.03', description: 'Search SAM.gov contract opportunities — NAICS, set-aside, agency, title' },
        { name: 'lookup_entity',    type: 'PAID', price_usdc: '0.02', description: 'SAM entity lookup by UEI — registration status, NAICS, set-aside eligibility' },
      ],
    },
    {
      product: 'Export Compliance',
      description: 'Restricted-party screening against all 11 US export-control and sanctions lists in one search — BIS Denied Persons/Entity/Unverified Lists, State ITAR Debarred + Nonproliferation Sanctions, Treasury OFAC SDN and 5 more',
      backend: 'https://data.trade.gov',
      tools: [
        { name: 'screen_restricted_party', type: 'PAID', price_usdc: '0.03', description: 'Screen an individual or entity name against the Consolidated Screening List — fuzzy name matching, filterable by source list or country' },
      ],
    },
    {
      product: 'Trade Leads',
      description: 'Real overseas contract/tender opportunities for US exporters — foreign government tenders and private-sector RFPs sourced by ITA\'s global commercial network',
      backend: 'https://data.trade.gov',
      tools: [
        { name: 'search_trade_leads', type: 'PAID', price_usdc: '0.03', description: 'Search live overseas trade leads — keyword, country, tender/contract date range' },
      ],
    },
    {
      product: 'Crypto Market Data',
      description: 'Real-time token price, market cap, and 24h volume/change — the same category CoinGecko itself runs on x402 at $0.01/call',
      backend: 'https://api.coingecko.com',
      tools: [
        { name: 'crypto_token_price', type: 'PAID', price_usdc: '0.01', description: 'Real-time price, market cap, and 24h volume/change for one or more tokens against one or more currencies' },
      ],
    },
    {
      product: 'SqueezeOS',
      description: 'Institutional-grade equity intelligence — squeeze scanner, options flow, multi-engine AI council verdicts',
      backend: 'https://squeezeos-api.onrender.com',
      tools: [
        { name: 'squeezeos_preview',            type: 'FREE',       description: 'Signal bias preview for any ticker (15-min cache)' },
        { name: 'squeezeos_history',            type: 'FREE',       description: 'Recent signal history — up to 200 events per symbol' },
        { name: 'squeezeos_oracle',             type: 'FREE',       description: 'Oracle directive — aggregated signal across all engines' },
        { name: 'squeezeos_ftd',                type: 'FREE',       description: 'SEC FTD (Failure to Deliver) registry for threshold securities' },
        { name: 'squeezeos_status',             type: 'FREE',       description: 'SqueezeOS system health and uptime' },
        { name: 'squeezeos_demo',               type: 'FREE',       description: 'Free IWM council verdict sample (5-min cache)' },
        { name: 'squeezeos_marketplace_browse', type: 'FREE',       description: 'Browse peer signal marketplace — listings and metadata' },
        { name: 'squeezeos_futures_leaderboard',type: 'FREE',       description: 'Top signal prediction market performers' },
        { name: 'squeezeos_council',            type: 'PAID',       price_usdc: '0.10', description: 'Multi-engine AI council verdict for any symbol — highest confidence signal' },
        { name: 'squeezeos_scan',               type: 'PAID',       price_usdc: '0.05', description: 'Full $1–$50 squeeze candidate scanner — ranked by squeeze score' },
        { name: 'squeezeos_options',            type: 'PAID',       price_usdc: '0.05', description: 'Institutional options flow analysis — dark pool, sweep detection' },
        { name: 'squeezeos_iwm',                type: 'PAID',       price_usdc: '0.03', description: 'IWM 0DTE contract scorer — real-time Greeks and probability' },
        { name: 'squeezeos_marketplace_read',   type: 'PAID',       price_usdc: '0.02', description: 'Full signal thesis from peer marketplace — complete analysis' },
      ],
    },
    {
      product: 'Equities & Options Heatmap (AI Swarm)',
      description: 'Self-contained RSI heatmap for equities and Delta heatmap for options — real market data (Tradier preferred when configured, including real OPRA-fed Greeks on options; falls back to Polygon.io with a locally modeled Black-Scholes Delta), each with a real 4-agent Claude swarm verdict (not a rule-based mock). Every result reports which real provider supplied it. AMC/GME/IWM are always scanned; the rest of the equities watchlist is real dynamically-discovered top movers, never a hardcoded list.',
      backend: 'self-contained (Tradier and/or Polygon.io + Anthropic Claude)',
      tools: [
        { name: 'equities_heatmap_preview',      type: 'FREE', description: 'AMC/GME/IWM + 2 dynamically-discovered movers, RSI(14) preview, 1 group, no AI swarm' },
        { name: 'equities_heatmap_full',         type: 'PAID', price_usdc: '0.10', description: 'RSI(14) heatmap across up to 20 tickers — AMC/GME/IWM always included, rest filled from real day gainers/losers unless explicit tickers are given — 4 groups + 4-agent Claude swarm verdict (MOMENTUM_QUANT, SECTOR_ROTATION, RISK_SENTINEL, MACRO_ORACLE)' },
        { name: 'options_delta_heatmap_preview', type: 'FREE', description: '5-contract Delta preview (AMC calls by default), 1 group, no AI swarm' },
        { name: 'options_delta_heatmap_full',    type: 'PAID', price_usdc: '0.15', description: 'Live options chain snapshot across up to 40 contracts — real Tradier Greeks when configured, else locally-computed Black-Scholes Delta — 4 groups + 4-agent Claude swarm verdict, plus a real 0.35-0.40 delta "sweet spot" scan with an explicit BUY/SELL + strike + expiration recommendation (GREEKS_ANALYST, IV_SKEW_HUNTER, GAMMA_WATCH, RISK_SENTINEL)' },
      ],
    },
    {
      product: 'Ghost Layer',
      description: 'Ephemeral dual-chain XRPL+Base toll routing gateway for autonomous agents',
      backend: 'https://ghost-layer.onrender.com',
      tools: [
        { name: 'ghost_status', type: 'FREE', description: 'Ghost Layer service health and active routes' },
        { name: 'ghost_route',  type: 'PAID', price_usdc: '0.01', description: 'Route transaction through dual-chain XRPL+Base gateway with toll collection' },
      ],
    },
    {
      product: '402Proof',
      description: 'x402 payment firewall — invoice gen, XRPL tx verification, Agent Credit Bureau (score 300–850)',
      backend: 'https://four02proof.onrender.com',
      tools: [
        { name: 'proof_invoice',      type: 'FREE', description: 'Generate x402 payment invoice for any SML endpoint — returns amount, chain, wallet' },
        { name: 'proof_verify',       type: 'FREE', description: 'Verify XRPL or Base payment tx_hash — returns receipt and confirmation' },
        { name: 'proof_credit_score', type: 'FREE', description: 'Get agent credit score (300–850) and payment history by wallet address' },
      ],
    },
    {
      product: 'RLUSD Rails',
      description: 'RLUSD/XRP remittance rails on XRPL and Xahau networks',
      backend: 'https://sml-rails.onrender.com',
      tools: [
        { name: 'rails_status',   type: 'FREE', description: 'RLUSD Rails service health and network status' },
        { name: 'rails_transfer', type: 'PAID', price_usdc: '0.01', description: 'Initiate RLUSD or XRP transfer via SML Rails — returns tx_hash' },
      ],
    },
    {
      product: 'XRPL Copy-Trader',
      description: 'Copy institutional whale positions on the XRP Ledger autonomously',
      backend: 'https://sml-copytrader.onrender.com',
      tools: [
        { name: 'copytrader_status',    type: 'FREE', description: 'Copy-Trader service health and active subscriptions count' },
        { name: 'copytrader_whales',    type: 'FREE', description: 'List tracked whale wallets, their recent moves, and performance metrics' },
        { name: 'copytrader_subscribe', type: 'PAID', price_usdc: '0.05', description: 'Subscribe to mirror a whale wallet — auto-copies all future positions' },
      ],
    },
    {
      product: 'Memecoin Launchpad',
      description: 'XRPL memecoin bonding curve launchpad — create and trade tokens',
      backend: 'https://sml-launchpad.onrender.com',
      tools: [
        { name: 'launchpad_status', type: 'FREE', description: 'Launchpad service health and total tokens launched' },
        { name: 'launchpad_list',   type: 'FREE', description: 'Browse live memecoins on bonding curve — price, volume, holders' },
        { name: 'launchpad_create', type: 'PAID', price_usdc: '0.10', description: 'Create new memecoin with bonding curve — supply, price curve, metadata' },
        { name: 'launchpad_buy',    type: 'PAID', price_usdc: '0.01', description: 'Buy tokens on memecoin bonding curve — returns executed price and tx' },
      ],
    },
    {
      product: 'Shadow Desk',
      description: 'MCP signal intelligence server with alpha-provider billing',
      backend: 'https://shadow-desk.onrender.com',
      tools: [
        { name: 'shadow_query',  type: 'PAID', price_usdc: '0.02', description: 'Query signal intelligence from Shadow Desk alpha feed' },
        { name: 'shadow_ingest', type: 'PAID', price_usdc: '0.01', description: 'Ingest alpha signal data into Shadow Desk for distribution' },
      ],
    },
    {
      product: 'Forge Gateway',
      description: 'x402 payment protocol + BYOK LLM proxy — pay per token, any model',
      backend: 'https://forge-gateway-a822.onrender.com',
      tools: [
        { name: 'forge_status', type: 'FREE', description: 'Forge Gateway health and supported models' },
        { name: 'forge_llm',    type: 'PAID', price_usdc: '0.02', description: 'BYOK LLM proxy — call any AI model, pay per request via x402' },
      ],
    },
    {
      product: 'agentcard',
      description: 'Ed25519 A2A agent identity cards — mint, lookup, verify agent signatures',
      backend: 'configurable via AGENTCARD_URL env var',
      tools: [
        { name: 'agentcard_lookup', type: 'FREE', description: 'Lookup agent identity card by wallet address or DID' },
        { name: 'agentcard_verify', type: 'FREE', description: 'Verify Ed25519 agent signature against their identity card' },
        { name: 'agentcard_mint',   type: 'PAID', price_usdc: '0.01', description: 'Create new Ed25519 agent identity card — returns card JSON and DID' },
      ],
    },
    {
      product: 'APM (Agent Preference Manifest)',
      description: 'Ask, don’t guess. Declare what you NEED (capability, budget, chain, freshness) and get the exact LIVE tool(s) that match — saving the tokens and failed payments of trial-and-error across the catalog.',
      backend: 'https://squeezeos-api.onrender.com',
      tools: [
        { name: 'apm_negotiate', type: 'FREE|PAID', price_usdc: '0.02', description: 'FREE preview returns match count + best category. PAID contract ($0.02) returns the full ranked plan with prices, live-status, brokerage terms, and a price-locked signed quote.' },
        { name: 'apm_execute', type: 'PAID', price_usdc: 'locked price + 5% brokerage', description: 'Execute a tool recommended by apm_negotiate under its signed price-locked quote. Charges the locked price + 5% brokerage, runs the tool, returns the result. Brokers the live SqueezeOS family today.' },
      ],
    },
    {
      product: 'echo-forge',
      description: 'Historical equity pattern similarity engine — ML cosine similarity on Polygon.io data',
      backend: 'coming_soon',
      tools: [
        { name: 'echo_pattern_match', type: 'PAID', price_usdc: '0.05', status: 'coming_soon', description: '[COMING SOON] Find historical equity patterns similar to current price action' },
      ],
    },
    {
      product: 'Core SML Intelligence',
      description: 'Original 6 SML tools — squeeze signals, EDGAR parsing, earnings oracle, FTD data, agent hiring, web scraping',
      tools: [
        { name: 'leviathan_signal',     type: 'PAID',      price_usdc: '0.05',        description: 'Institutional squeeze signals — proprietary multi-engine verdict for any ticker' },
        { name: 'xmit_edgar_decode',    type: 'PAID',      price_usdc: '0.02',        description: 'Parse SEC DEF 14A / 13F / 13D filings — raw text never leaves SML servers' },
        { name: 'xdeo_earnings_estimate',type:'PAID',      price_usdc: '0.02',        description: 'Decentralized earnings oracle — consensus estimate across data sources' },
        { name: 'ftd_threshold_scan',   type: 'FREE|PAID', price_usdc: '0.05',        description: 'SEC Reg SHO FTD data — threshold alerts free, full scanner $0.05' },
        { name: 'nexus_agent_hire',     type: 'FREE|PAID', price_usdc: '5% commission', description: 'Agent job marketplace — browse free, hire charges 5% of contract value' },
        { name: 'crawl_paid_fetch',     type: 'PAID',      price_usdc: '0.005',       description: 'Pay-per-fetch web scraping — humans bypass free, AI agents pay $0.005/fetch' },
      ],
    },
  ],
  stats: {
    total_tools: 49,
    free_tools: 24,
    paid_tools: 24,
    products: 13,
    chains_supported: 3,
  },
};

export function registerDiscovery(server: McpServer): void {
  server.tool(
    'sml_discover',
    'Returns the complete ScriptMasterLabs product catalog — all 43 tools, prices, and payment instructions. Call this first. FREE.',
    {},
    async () => {
      AuditLogger.getInstance().info('sml_discover', {});
      return { content: [{ type: 'text' as const, text: JSON.stringify(CATALOG, null, 2) }] };
    },
  );

  server.tool(
    'sml_status',
    'Real-time health check of all 8 SML backends simultaneously. Call before making paid requests to avoid wasted payments. FREE.',
    {},
    async () => {
      AuditLogger.getInstance().info('sml_status', {});
      const health = await checkBackends(5000);
      const statuses = health.map((h) =>
        h.status === 'offline'
          ? { name: h.name, status: h.status, error: h.error, latency_ms: h.latency_ms }
          : { name: h.name, status: h.status, http: h.http, latency_ms: h.latency_ms },
      );
      const online = statuses.filter((s) => s.status === 'online').length;
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            summary: `${online}/${BACKENDS.length} backends online`,
            all_systems_go: online === BACKENDS.length,
            backends: statuses,
            checked_at: new Date().toISOString(),
            tip: online < BACKENDS.length ? 'Some backends are offline. Avoid paid calls to those products.' : 'All systems operational. Safe to make paid calls.',
          }, null, 2),
        }],
      };
    },
  );
}
