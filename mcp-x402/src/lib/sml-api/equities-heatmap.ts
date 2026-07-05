// Self-contained equities RSI heatmap + options Delta heatmap.
// Unlike squeezeos.ts (which proxies squeezeos-api.onrender.com), these pull
// market data directly and compute RSI/Delta locally, then run a real
// multi-agent Claude swarm over the result.
//
// Market-data credentials are BYOK: a caller may supply their own
// Tradier/Polygon/Alpaca keys (per-call), which always take priority over
// this server's own env-configured keys. This means the operator never pays
// another user's market-data bill — only the Claude swarm compute (already
// covered by the x402 price) runs on the operator's own account. If a caller
// supplies nothing, this server's own keys are used as a convenience default.
//
// Data source priority (whichever set of credentials is in effect): Tradier
// first — same "Tradier preferred for options" priority the main SqueezeOS
// app uses — falling back to Polygon.io. For options specifically, Tradier
// also supplies real OPRA-fed Greeks, used directly instead of a locally
// modeled Black-Scholes delta when available: a market-observed delta is
// strictly better than our own estimate. Every result reports which real
// provider supplied it (Prime Directive: every data point must have a
// traceable source).

import { fetchEquityCloses as fetchEquityClosesPolygon, fetchOptionsChainSnapshot, fetchTrendingTickers as fetchTrendingTickersPolygon, type EquityTimeframe } from '../market-data/polygon.js';
import { fetchEquityCloses as fetchEquityClosesTradier, fetchOptionsChainWithGreeks } from '../market-data/tradier.js';
import { fetchTrendingTickers as fetchTrendingTickersAlpaca } from '../market-data/alpaca.js';
import { computeRSI } from '../quant/indicators.js';
import { blackScholesDelta } from '../quant/greeks.js';
import { buildHeatmap, type HeatmapItem, type HeatmapResult } from '../quant/heatmap.js';
import { runSwarm, EQUITIES_SWARM_PERSONAS, OPTIONS_SWARM_PERSONAS, type SwarmResult } from '../ai/swarm.js';
import { AuditLogger } from '../../server/security/audit.js';

const SERVER_POLYGON_API_KEY = process.env['POLYGON_API_KEY'] ?? '';
const SERVER_ALPACA_API_KEY = process.env['ALPACA_API_KEY'] ?? '';
const SERVER_ALPACA_API_SECRET = process.env['ALPACA_API_SECRET'] ?? '';
const SERVER_TRADIER_API_KEY = process.env['TRADIER_API_KEY'] ?? '';
const ANTHROPIC_API_KEY = process.env['ANTHROPIC_API_KEY'] ?? '';
const ANTHROPIC_MODEL = process.env['ANTHROPIC_MODEL'] ?? 'claude-sonnet-4-5';

export type DataSource = 'tradier' | 'polygon';

/** Caller-supplied market-data credentials (BYOK) — always preferred over this server's own keys. */
export interface DataCredentials {
  tradierApiKey?: string;
  polygonApiKey?: string;
  alpacaApiKey?: string;
  alpacaApiSecret?: string;
}

interface ResolvedCredentials {
  tradier: string;
  polygon: string;
  alpacaKey: string;
  alpacaSecret: string;
}

/** A caller's own key always wins; this server's env-configured key is only a convenience fallback. */
function resolveCredentials(creds?: DataCredentials): ResolvedCredentials {
  return {
    tradier: creds?.tradierApiKey || SERVER_TRADIER_API_KEY,
    polygon: creds?.polygonApiKey || SERVER_POLYGON_API_KEY,
    alpacaKey: creds?.alpacaApiKey || SERVER_ALPACA_API_KEY,
    alpacaSecret: creds?.alpacaApiSecret || SERVER_ALPACA_API_SECRET,
  };
}

/** Always scanned regardless of dynamic discovery — the core squeeze watchlist. */
export const ALWAYS_WATCH = ['AMC', 'GME', 'IWM'];

/** Default options underlying when none is requested — the flagship squeeze name. */
export const DEFAULT_OPTIONS_UNDERLYING = 'AMC';

/** The "sweet spot" delta band traders commonly target for premium buy/sell decisions. */
const DELTA_BAND_LOW = 35;
const DELTA_BAND_HIGH = 40;

/**
 * Free-preview contract sampling: takes the `count` contracts whose strikes
 * sit closest to the live underlying price. Both Tradier and Polygon return
 * contracts strike-ascending, so a naive slice(0, count) always grabs the
 * deepest-in-the-money strikes — pinned near |delta|=1.0 for every result,
 * regardless of ticker. Sorting by proximity to spot instead gives a
 * representative mix of deltas, same as what an actual near-the-money scan
 * would show.
 */
export function nearestToMoney<T extends { strike: number }>(contracts: T[], underlyingPrice: number, count: number): T[] {
  return [...contracts].sort((a, b) => Math.abs(a.strike - underlyingPrice) - Math.abs(b.strike - underlyingPrice)).slice(0, count);
}

export interface DeltaBandPick {
  symbol: string;
  strike: number;
  expirationDate: string;
  /** Real delta (0-1), not the x100 heatmap scale. */
  delta: number;
}

/** Real contracts (from actual chain data, never invented) whose |delta| falls in the 0.35-0.40 band. */
function pickDeltaBand(items: HeatmapItem[]): DeltaBandPick[] {
  return items
    .filter((i) => i.value >= DELTA_BAND_LOW && i.value <= DELTA_BAND_HIGH)
    .map((i) => ({
      symbol: i.symbol,
      strike: Number(i.meta?.['strike']),
      expirationDate: String(i.meta?.['expirationDate'] ?? ''),
      delta: Math.round((i.value / 100) * 1000) / 1000,
    }))
    .filter((p) => Number.isFinite(p.strike) && p.expirationDate.length > 0);
}

/**
 * Real dynamic mover discovery, tried in order: Alpaca (free market-data tier
 * includes the movers/screener endpoint) first, then Polygon's gainers/losers
 * snapshot (gated behind a paid plan on some Polygon tiers) as a second real
 * source. Returns an empty list — never invented tickers — if neither is
 * configured or both fail.
 */
async function discoverTrendingTickers(limit: number, res: ResolvedCredentials): Promise<string[]> {
  if (res.alpacaKey && res.alpacaSecret) {
    try {
      return await fetchTrendingTickersAlpaca(res.alpacaKey, res.alpacaSecret, limit);
    } catch (err) {
      AuditLogger.getInstance().warn('alpaca_discovery_unavailable', { error: String(err) });
    }
  }
  if (res.polygon) {
    try {
      return await fetchTrendingTickersPolygon(res.polygon, limit);
    } catch (err) {
      AuditLogger.getInstance().warn('polygon_discovery_unavailable', { error: String(err) });
    }
  }
  return [];
}

/**
 * Resolves the ticker list for a scan. An explicit `requested` list from the
 * caller always wins outright. Otherwise: ALWAYS_WATCH first, then real
 * dynamically-discovered top movers (Alpaca, then Polygon) fill the rest. If
 * discovery is unavailable from either provider, this falls back to
 * ALWAYS_WATCH alone rather than erroring out — AMC/GME/IWM are always real,
 * live data regardless of discovery working, never a fabricated blue-chip list.
 */
async function resolveSymbols(requested: string[] | undefined, limit: number, res: ResolvedCredentials): Promise<string[]> {
  if (requested && requested.length > 0) {
    return requested.slice(0, limit).map((s) => String(s).toUpperCase());
  }
  const trending = await discoverTrendingTickers(limit, res);
  const merged: string[] = [...ALWAYS_WATCH];
  for (const t of trending) {
    if (merged.length >= limit) break;
    if (!merged.includes(t)) merged.push(t);
  }
  return merged.slice(0, limit);
}

function requireConfig(res: ResolvedCredentials): void {
  const missing = [
    !res.tradier && !res.polygon && 'a Tradier or Polygon API key (BYOK or server-configured)',
    !ANTHROPIC_API_KEY && 'ANTHROPIC_API_KEY',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`not_configured: missing ${missing.join(', ')} on this server`);
  }
}

/** Tradier first (if configured), falling back to Polygon. Surfaces the real error if neither works. */
async function fetchClosesWithFallback(symbol: string, timeframe: EquityTimeframe, res: ResolvedCredentials): Promise<{ closes: number[]; source: DataSource }> {
  let tradierErr: unknown;
  if (res.tradier) {
    try {
      const closes = await fetchEquityClosesTradier(symbol, timeframe, res.tradier);
      if (closes.length > 0) return { closes, source: 'tradier' };
    } catch (err) {
      tradierErr = err;
    }
  }
  if (res.polygon) {
    const closes = await fetchEquityClosesPolygon(symbol, timeframe, res.polygon);
    return { closes, source: 'polygon' };
  }
  if (tradierErr) throw tradierErr;
  throw new Error('not_configured: missing a Tradier or Polygon API key (BYOK or server-configured)');
}

function summarizeSources(sources: Set<DataSource>): string {
  return [...sources].sort().join('+') || 'unknown';
}

function buildEquitiesSwarmContext(heatmap: HeatmapResult, timeframe: string, source: string): string {
  const lines = heatmap.groups.map(
    (g) => `${g.group}: avg=${g.avg} min=${g.min} max=${g.max} | ${g.items.map((i) => `${i.symbol}=${i.value}`).join(', ')}`,
  );
  return [
    `Equities RSI(14) heatmap — timeframe ${timeframe}, scale ${heatmap.scale}, data source: ${source}.`,
    `Overbought threshold: ${heatmap.overboughtThreshold}. Oversold threshold: ${heatmap.oversoldThreshold}.`,
    ...lines,
  ].join('\n');
}

function buildOptionsSwarmContext(
  heatmap: HeatmapResult,
  underlying: string,
  optionType: string,
  underlyingPrice: number,
  source: string,
  deltaBandPicks: DeltaBandPick[],
): string {
  const lines = heatmap.groups.map(
    (g) => `${g.group}: avg=${g.avg} min=${g.min} max=${g.max} | ${g.items.map((i) => `${i.symbol}=${i.value}`).join(', ')}`,
  );
  const parts = [
    `Options Delta heatmap — underlying ${underlying} @ ${underlyingPrice}, ${optionType}s, scale ${heatmap.scale}, data source: ${source}.`,
    `High bucket (>=${heatmap.overboughtThreshold}) = deep ITM. Low bucket (<=${heatmap.oversoldThreshold}) = deep OTM.`,
    ...lines,
  ];
  if (deltaBandPicks.length > 0) {
    parts.push(
      '',
      `Delta sweet-spot scan (0.35-0.40 delta ${optionType}s) — real contracts from the chain above matching this band:`,
      ...deltaBandPicks.map((p) => `${p.symbol}: strike=${p.strike}, expiration=${p.expirationDate}, delta=${p.delta}`),
      `Task: give a clear BUY or SELL call on ${optionType}s of ${underlying}, naming the single best strike and expiration date from the list above, with your reasoning grounded in the heatmap and delta data (not the list order).`,
    );
  }
  return parts.join('\n');
}

export interface EquitiesHeatmapResult {
  tool: 'equities_heatmap_full';
  timeframe: EquityTimeframe;
  dataSource: string;
  heatmap: HeatmapResult;
  swarm: SwarmResult;
}

export interface OptionsDeltaHeatmapResult {
  tool: 'options_delta_heatmap_full';
  underlying: string;
  optionType: 'call' | 'put';
  underlyingPrice: number;
  dataSource: string;
  heatmap: HeatmapResult;
  /** Real contracts from the chain whose delta falls in the 0.35-0.40 sweet spot. */
  deltaBandPicks: DeltaBandPick[];
  swarm: SwarmResult;
}

export const EquitiesHeatmapAPI = {
  /** Free preview: AMC/GME/IWM + 2 dynamically-discovered movers, 1 group, no AI swarm. */
  async preview(creds?: DataCredentials): Promise<{ tool: string; tier: 'free'; timeframe: EquityTimeframe; dataSource: string; heatmap: HeatmapResult }> {
    const res = resolveCredentials(creds);
    if (!res.tradier && !res.polygon) {
      throw new Error('not_configured: missing a Tradier or Polygon API key (BYOK or server-configured)');
    }
    const previewSymbols = await resolveSymbols(undefined, 5, res);
    const items: HeatmapItem[] = [];
    const sources = new Set<DataSource>();
    await Promise.all(
      previewSymbols.map(async (symbol) => {
        const { closes, source } = await fetchClosesWithFallback(symbol, '1h', res);
        const rsi = computeRSI(closes);
        if (rsi !== null) { items.push({ symbol, value: rsi }); sources.add(source); }
      }),
    );
    const heatmap = buildHeatmap(items, { groupsOf: 1, overboughtThreshold: 70, oversoldThreshold: 30, scale: 'RSI(14), 0-100' });
    return { tool: 'equities_heatmap_preview', tier: 'free', timeframe: '1h', dataSource: summarizeSources(sources), heatmap };
  },

  /** Paid: up to 20 tickers, 4-group heatmap, 4-agent Claude swarm verdict. */
  async full(tickers: string[] | undefined, timeframe: EquityTimeframe | undefined, creds?: DataCredentials): Promise<EquitiesHeatmapResult> {
    const res = resolveCredentials(creds);
    requireConfig(res);
    const resolvedTimeframe: EquityTimeframe = timeframe ?? '1h';
    const symbols = await resolveSymbols(tickers, 20, res);

    const items: HeatmapItem[] = [];
    const sources = new Set<DataSource>();
    await Promise.all(
      symbols.map(async (symbol) => {
        const { closes, source } = await fetchClosesWithFallback(symbol, resolvedTimeframe, res);
        const rsi = computeRSI(closes);
        if (rsi !== null) { items.push({ symbol, value: rsi }); sources.add(source); }
      }),
    );

    if (items.length === 0) {
      throw new Error('no_data: could not compute RSI for any requested ticker — insufficient bar history from market data provider(s)');
    }

    const dataSource = summarizeSources(sources);
    const heatmap = buildHeatmap(items, { overboughtThreshold: 70, oversoldThreshold: 30, scale: 'RSI(14), 0-100' });
    const swarm = await runSwarm(EQUITIES_SWARM_PERSONAS, buildEquitiesSwarmContext(heatmap, resolvedTimeframe, dataSource), {
      apiKey: ANTHROPIC_API_KEY,
      model: ANTHROPIC_MODEL,
    });

    return { tool: 'equities_heatmap_full', timeframe: resolvedTimeframe, dataSource, heatmap, swarm };
  },
};

export const OptionsDeltaHeatmapAPI = {
  /** Free preview: 5 call contracts, 1 group, no AI swarm. */
  async preview(underlying = DEFAULT_OPTIONS_UNDERLYING, creds?: DataCredentials): Promise<{ tool: string; tier: 'free'; underlying: string; underlyingPrice: number; dataSource: string; heatmap: HeatmapResult }> {
    const res = resolveCredentials(creds);
    const symbol = underlying.toUpperCase();

    if (res.tradier) {
      try {
        const chain = await fetchOptionsChainWithGreeks(symbol, res.tradier, { contractType: 'call' });
        const priced = nearestToMoney(chain.contracts.filter((c) => typeof c.delta === 'number'), chain.underlyingPrice, 5);
        if (priced.length > 0 && chain.underlyingPrice > 0) {
          const items: HeatmapItem[] = priced.map((c) => ({
            symbol: `${chain.underlying} ${c.strike}C ${c.expirationDate}`,
            value: Math.round(Math.abs(c.delta as number) * 1000) / 10,
          }));
          const heatmap = buildHeatmap(items, { groupsOf: 1, overboughtThreshold: 70, oversoldThreshold: 30, scale: '|Delta| x100, calls (real Tradier greeks)' });
          return { tool: 'options_delta_heatmap_preview', tier: 'free', underlying: chain.underlying, underlyingPrice: chain.underlyingPrice, dataSource: 'tradier', heatmap };
        }
      } catch {
        // fall through to Polygon below
      }
    }

    if (!res.polygon) throw new Error('not_configured: missing a Tradier or Polygon API key (BYOK or server-configured)');
    const fullChain = await fetchOptionsChainSnapshot(symbol, res.polygon, { contractType: 'call', limit: 40 });
    if (fullChain.contracts.length === 0 || fullChain.underlyingPrice <= 0) {
      throw new Error(`no_data: no options contracts returned for ${symbol}`);
    }
    const chain = { ...fullChain, contracts: nearestToMoney(fullChain.contracts, fullChain.underlyingPrice, 5) };
    const items: HeatmapItem[] = chain.contracts.map((c) => {
      const timeToExpiryYears = Math.max((new Date(c.expirationDate).getTime() - Date.now()) / (365.25 * 24 * 3600 * 1000), 1 / 365.25);
      const delta = blackScholesDelta({ spot: chain.underlyingPrice, strike: c.strike, timeToExpiryYears, volatility: c.impliedVolatility ?? 0.3, optionType: 'call' });
      return { symbol: `${chain.underlying} ${c.strike}C ${c.expirationDate}`, value: Math.round(Math.abs(delta) * 1000) / 10 };
    });
    const heatmap = buildHeatmap(items, { groupsOf: 1, overboughtThreshold: 70, oversoldThreshold: 30, scale: '|Delta| x100, calls (modeled, Black-Scholes)' });
    return { tool: 'options_delta_heatmap_preview', tier: 'free', underlying: chain.underlying, underlyingPrice: chain.underlyingPrice, dataSource: 'polygon', heatmap };
  },

  /** Paid: up to 40 contracts, 4-group heatmap, 4-agent Claude swarm verdict. */
  async full(
    underlying: string | undefined,
    expirationDate: string | undefined,
    optionType: 'call' | 'put' | undefined,
    creds?: DataCredentials,
  ): Promise<OptionsDeltaHeatmapResult> {
    const res = resolveCredentials(creds);
    requireConfig(res);
    const symbol = (underlying ?? DEFAULT_OPTIONS_UNDERLYING).toUpperCase();
    const side: 'call' | 'put' = optionType === 'put' ? 'put' : 'call';

    if (res.tradier) {
      try {
        const chain = await fetchOptionsChainWithGreeks(symbol, res.tradier, { expirationDate, contractType: side });
        const priced = chain.contracts.filter((c) => typeof c.delta === 'number').slice(0, 40);
        if (priced.length > 0 && chain.underlyingPrice > 0) {
          const items: HeatmapItem[] = priced.map((c) => ({
            symbol: `${symbol} ${c.strike}${side === 'call' ? 'C' : 'P'} ${c.expirationDate}`,
            value: Math.round(Math.abs(c.delta as number) * 1000) / 10,
            meta: { strike: c.strike, expirationDate: c.expirationDate },
          }));
          const heatmap = buildHeatmap(items, {
            overboughtThreshold: 70,
            oversoldThreshold: 30,
            scale: `|Delta| x100 (deep ITM=high / deep OTM=low), ${side}s (real Tradier greeks)`,
          });
          const deltaBandPicks = pickDeltaBand(items);
          const swarm = await runSwarm(
            OPTIONS_SWARM_PERSONAS,
            buildOptionsSwarmContext(heatmap, symbol, side, chain.underlyingPrice, 'tradier', deltaBandPicks),
            { apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL },
          );
          return { tool: 'options_delta_heatmap_full', underlying: symbol, optionType: side, underlyingPrice: chain.underlyingPrice, dataSource: 'tradier', heatmap, deltaBandPicks, swarm };
        }
      } catch {
        // fall through to Polygon below
      }
    }

    if (!res.polygon) throw new Error('not_configured: missing a Tradier or Polygon API key (BYOK or server-configured)');
    const chain = await fetchOptionsChainSnapshot(symbol, res.polygon, { expirationDate, contractType: side, limit: 40 });
    if (chain.contracts.length === 0 || chain.underlyingPrice <= 0) {
      throw new Error(`no_data: no options contracts (or underlying price) returned for ${symbol}`);
    }

    const items: HeatmapItem[] = chain.contracts.map((c) => {
      const timeToExpiryYears = Math.max(
        (new Date(c.expirationDate).getTime() - Date.now()) / (365.25 * 24 * 3600 * 1000),
        1 / 365.25,
      );
      const delta = blackScholesDelta({
        spot: chain.underlyingPrice,
        strike: c.strike,
        timeToExpiryYears,
        volatility: c.impliedVolatility ?? 0.3,
        optionType: side,
      });
      return {
        symbol: `${symbol} ${c.strike}${side === 'call' ? 'C' : 'P'} ${c.expirationDate}`,
        value: Math.round(Math.abs(delta) * 1000) / 10,
        meta: { strike: c.strike, expirationDate: c.expirationDate, impliedVolatility: c.impliedVolatility },
      };
    });

    const heatmap = buildHeatmap(items, {
      overboughtThreshold: 70,
      oversoldThreshold: 30,
      scale: `|Delta| x100 (deep ITM=high / deep OTM=low), ${side}s (modeled, Black-Scholes)`,
    });
    const deltaBandPicks = pickDeltaBand(items);
    const swarm = await runSwarm(
      OPTIONS_SWARM_PERSONAS,
      buildOptionsSwarmContext(heatmap, symbol, side, chain.underlyingPrice, 'polygon', deltaBandPicks),
      { apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL },
    );

    return { tool: 'options_delta_heatmap_full', underlying: symbol, optionType: side, underlyingPrice: chain.underlyingPrice, dataSource: 'polygon', heatmap, deltaBandPicks, swarm };
  },
};
