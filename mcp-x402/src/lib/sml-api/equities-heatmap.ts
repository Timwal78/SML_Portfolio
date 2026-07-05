// Self-contained equities RSI heatmap + options Delta heatmap.
// Unlike squeezeos.ts (which proxies squeezeos-api.onrender.com), these pull
// market data directly and compute RSI/Delta locally, then run a real
// multi-agent Claude swarm over the result.
//
// Data source priority: Tradier first when TRADIER_API_KEY is configured —
// same "Tradier preferred for options" priority the main SqueezeOS app uses —
// falling back to Polygon.io. For options specifically, Tradier also supplies
// real OPRA-fed Greeks, which are used directly instead of a locally modeled
// Black-Scholes delta when available: a market-observed delta is strictly
// better than our own estimate. Every result reports which real provider
// supplied it (Prime Directive: every data point must have a traceable source).

import { fetchEquityCloses as fetchEquityClosesPolygon, fetchOptionsChainSnapshot, type EquityTimeframe } from '../market-data/polygon.js';
import { fetchEquityCloses as fetchEquityClosesTradier, fetchOptionsChainWithGreeks } from '../market-data/tradier.js';
import { computeRSI } from '../quant/indicators.js';
import { blackScholesDelta } from '../quant/greeks.js';
import { buildHeatmap, type HeatmapItem, type HeatmapResult } from '../quant/heatmap.js';
import { runSwarm, EQUITIES_SWARM_PERSONAS, OPTIONS_SWARM_PERSONAS, type SwarmResult } from '../ai/swarm.js';

const POLYGON_API_KEY = process.env['POLYGON_API_KEY'] ?? '';
const TRADIER_API_KEY = process.env['TRADIER_API_KEY'] ?? '';
const ANTHROPIC_API_KEY = process.env['ANTHROPIC_API_KEY'] ?? '';
const ANTHROPIC_MODEL = process.env['ANTHROPIC_MODEL'] ?? 'claude-sonnet-4-5';

export type DataSource = 'tradier' | 'polygon';

export const DEFAULT_EQUITY_WATCHLIST = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN',
  'GOOGL', 'META', 'TSLA', 'AMD',
  'NFLX', 'JPM', 'XOM', 'UNH',
  'V', 'COST', 'AVGO', 'CRM',
];

function requireConfig(): void {
  const missing = [
    !TRADIER_API_KEY && !POLYGON_API_KEY && 'TRADIER_API_KEY or POLYGON_API_KEY',
    !ANTHROPIC_API_KEY && 'ANTHROPIC_API_KEY',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`not_configured: missing ${missing.join(', ')} on this server`);
  }
}

/** Tradier first (if configured), falling back to Polygon. Surfaces the real error if neither works. */
async function fetchClosesWithFallback(symbol: string, timeframe: EquityTimeframe): Promise<{ closes: number[]; source: DataSource }> {
  let tradierErr: unknown;
  if (TRADIER_API_KEY) {
    try {
      const closes = await fetchEquityClosesTradier(symbol, timeframe, TRADIER_API_KEY);
      if (closes.length > 0) return { closes, source: 'tradier' };
    } catch (err) {
      tradierErr = err;
    }
  }
  if (POLYGON_API_KEY) {
    const closes = await fetchEquityClosesPolygon(symbol, timeframe, POLYGON_API_KEY);
    return { closes, source: 'polygon' };
  }
  if (tradierErr) throw tradierErr;
  throw new Error('not_configured: missing TRADIER_API_KEY or POLYGON_API_KEY on this server');
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

function buildOptionsSwarmContext(heatmap: HeatmapResult, underlying: string, optionType: string, underlyingPrice: number, source: string): string {
  const lines = heatmap.groups.map(
    (g) => `${g.group}: avg=${g.avg} min=${g.min} max=${g.max} | ${g.items.map((i) => `${i.symbol}=${i.value}`).join(', ')}`,
  );
  return [
    `Options Delta heatmap — underlying ${underlying} @ ${underlyingPrice}, ${optionType}s, scale ${heatmap.scale}, data source: ${source}.`,
    `High bucket (>=${heatmap.overboughtThreshold}) = deep ITM. Low bucket (<=${heatmap.oversoldThreshold}) = deep OTM.`,
    ...lines,
  ].join('\n');
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
  swarm: SwarmResult;
}

export const EquitiesHeatmapAPI = {
  /** Free preview: 5 default tickers, 1 group, no AI swarm. */
  async preview(): Promise<{ tool: string; tier: 'free'; timeframe: EquityTimeframe; dataSource: string; heatmap: HeatmapResult }> {
    if (!TRADIER_API_KEY && !POLYGON_API_KEY) {
      throw new Error('not_configured: missing TRADIER_API_KEY or POLYGON_API_KEY on this server');
    }
    const previewSymbols = DEFAULT_EQUITY_WATCHLIST.slice(0, 5);
    const items: HeatmapItem[] = [];
    const sources = new Set<DataSource>();
    await Promise.all(
      previewSymbols.map(async (symbol) => {
        const { closes, source } = await fetchClosesWithFallback(symbol, '1h');
        const rsi = computeRSI(closes);
        if (rsi !== null) { items.push({ symbol, value: rsi }); sources.add(source); }
      }),
    );
    const heatmap = buildHeatmap(items, { groupsOf: 1, overboughtThreshold: 70, oversoldThreshold: 30, scale: 'RSI(14), 0-100' });
    return { tool: 'equities_heatmap_preview', tier: 'free', timeframe: '1h', dataSource: summarizeSources(sources), heatmap };
  },

  /** Paid: up to 20 tickers, 4-group heatmap, 4-agent Claude swarm verdict. */
  async full(tickers: string[] | undefined, timeframe: EquityTimeframe | undefined): Promise<EquitiesHeatmapResult> {
    requireConfig();
    const resolvedTimeframe: EquityTimeframe = timeframe ?? '1h';
    const symbols = (tickers && tickers.length > 0 ? tickers : DEFAULT_EQUITY_WATCHLIST)
      .slice(0, 20)
      .map((s) => String(s).toUpperCase());

    const items: HeatmapItem[] = [];
    const sources = new Set<DataSource>();
    await Promise.all(
      symbols.map(async (symbol) => {
        const { closes, source } = await fetchClosesWithFallback(symbol, resolvedTimeframe);
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
  async preview(underlying = 'SPY'): Promise<{ tool: string; tier: 'free'; underlying: string; underlyingPrice: number; dataSource: string; heatmap: HeatmapResult }> {
    const symbol = underlying.toUpperCase();

    if (TRADIER_API_KEY) {
      try {
        const chain = await fetchOptionsChainWithGreeks(symbol, TRADIER_API_KEY, { contractType: 'call' });
        const priced = chain.contracts.filter((c) => typeof c.delta === 'number').slice(0, 5);
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

    if (!POLYGON_API_KEY) throw new Error('not_configured: missing TRADIER_API_KEY or POLYGON_API_KEY on this server');
    const chain = await fetchOptionsChainSnapshot(symbol, POLYGON_API_KEY, { contractType: 'call', limit: 5 });
    if (chain.contracts.length === 0 || chain.underlyingPrice <= 0) {
      throw new Error(`no_data: no options contracts returned for ${symbol}`);
    }
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
  ): Promise<OptionsDeltaHeatmapResult> {
    requireConfig();
    const symbol = (underlying ?? 'SPY').toUpperCase();
    const side: 'call' | 'put' = optionType === 'put' ? 'put' : 'call';

    if (TRADIER_API_KEY) {
      try {
        const chain = await fetchOptionsChainWithGreeks(symbol, TRADIER_API_KEY, { expirationDate, contractType: side });
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
          const swarm = await runSwarm(
            OPTIONS_SWARM_PERSONAS,
            buildOptionsSwarmContext(heatmap, symbol, side, chain.underlyingPrice, 'tradier'),
            { apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL },
          );
          return { tool: 'options_delta_heatmap_full', underlying: symbol, optionType: side, underlyingPrice: chain.underlyingPrice, dataSource: 'tradier', heatmap, swarm };
        }
      } catch {
        // fall through to Polygon below
      }
    }

    if (!POLYGON_API_KEY) throw new Error('not_configured: missing TRADIER_API_KEY or POLYGON_API_KEY on this server');
    const chain = await fetchOptionsChainSnapshot(symbol, POLYGON_API_KEY, { expirationDate, contractType: side, limit: 40 });
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
    const swarm = await runSwarm(
      OPTIONS_SWARM_PERSONAS,
      buildOptionsSwarmContext(heatmap, symbol, side, chain.underlyingPrice, 'polygon'),
      { apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL },
    );

    return { tool: 'options_delta_heatmap_full', underlying: symbol, optionType: side, underlyingPrice: chain.underlyingPrice, dataSource: 'polygon', heatmap, swarm };
  },
};
