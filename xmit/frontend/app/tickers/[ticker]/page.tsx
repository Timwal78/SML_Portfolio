'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

interface TickerSummary {
  ticker: string;
  governanceGrade: string | null;
  governanceScore: number | null;
  redFlagCount: number;
  institutionalSentiment: string;
  topInsights: Insight[];
}

interface Insight {
  id: string;
  analyst_address: string;
  module: string;
  title: string;
  summary: string;
  confidence_score: number;
  price_micro: number;
  submitted_at: string;
  purchase_count: number;
}

const SENTIMENT_COLOR: Record<string, string> = {
  BULLISH: 'text-green-400',
  BEARISH: 'text-red-400',
  NEUTRAL: 'text-yellow-400',
  UNKNOWN: 'text-slate-500',
};

const MODULE_BADGE: Record<string, string> = {
  xcgo: 'bg-indigo-900/30 text-indigo-400 border-indigo-500/30',
  xstm: 'bg-red-900/30 text-red-400 border-red-500/30',
  xifd: 'bg-cyan-900/30 text-cyan-400 border-cyan-500/30',
};

export default function TickerPage() {
  const params = useParams<{ ticker: string }>();
  const ticker = params.ticker?.toUpperCase() ?? '';
  const [data, setData] = useState<TickerSummary | null>(null);

  useEffect(() => {
    if (!ticker) return;
    fetch(`${API}/api/v1/tickers/${ticker}`)
      .then((r) => r.json())
      .then((d: TickerSummary) => setData(d))
      .catch(() => {});
  }, [ticker]);

  if (!data) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-20 text-center text-slate-600">
        Loading {ticker}…
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <div className="flex items-center gap-4 mb-8">
        <h1 className="text-4xl font-bold text-white">${ticker}</h1>
        {data.governanceGrade && (
          <span className={`text-2xl font-bold grade-${data.governanceGrade[0]}`}>
            {data.governanceGrade}
          </span>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 mb-10">
        <StatCard
          label="Governance"
          value={data.governanceGrade ?? '—'}
          sub={data.governanceScore != null ? `Score: ${data.governanceScore.toFixed(0)}` : 'No data yet'}
          href={`/xcgo?ticker=${ticker}`}
        />
        <StatCard
          label="Red Flags"
          value={data.redFlagCount.toString()}
          sub="open xSTM flags"
          valueClass={data.redFlagCount > 5 ? 'text-red-400' : data.redFlagCount > 0 ? 'text-yellow-400' : 'text-green-400'}
          href={`/xstm?ticker=${ticker}`}
        />
        <StatCard
          label="Smart Money"
          value={data.institutionalSentiment}
          sub="13F consensus"
          valueClass={SENTIMENT_COLOR[data.institutionalSentiment] ?? 'text-slate-400'}
          href={`/xifd?ticker=${ticker}`}
        />
      </div>

      {/* Top Insights */}
      <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Top Insights</h2>
      {data.topInsights.length === 0 ? (
        <div className="bg-xmit-surface border border-xmit-border rounded-lg p-8 text-center text-slate-600">
          No insights yet for {ticker}. Submit the first one.
        </div>
      ) : (
        <div className="space-y-3">
          {data.topInsights.map((ins) => (
            <a
              key={ins.id}
              href={`/insights/${ins.id}`}
              className="bg-xmit-surface border border-xmit-border hover:border-xmit-accent/40 rounded-lg p-4 block transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`text-xs border rounded px-1.5 py-0.5 ${MODULE_BADGE[ins.module] ?? ''}`}
                    >
                      {ins.module.toUpperCase()}
                    </span>
                    <span className="text-white font-semibold text-sm">{ins.title}</span>
                  </div>
                  <p className="text-slate-400 text-xs line-clamp-2">{ins.summary}</p>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xmit-green text-sm font-semibold">
                    ${(ins.price_micro / 1_000_000).toFixed(2)}
                  </div>
                  <div className="text-xs text-slate-500">{ins.purchase_count} buys</div>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}

      {/* Quick access */}
      <div className="grid grid-cols-3 gap-3 mt-8">
        <a
          href={`${API}/api/v1/tickers/${ticker}/governance`}
          target="_blank"
          className="bg-indigo-900/20 border border-indigo-500/30 rounded-lg p-3 text-center text-xs text-indigo-400 hover:border-indigo-500 transition-colors"
        >
          Full xCGO Report
          <div className="text-slate-500 mt-0.5">$0.01 via x402</div>
        </a>
        <a
          href={`${API}/api/v1/tickers/${ticker}/redflags`}
          target="_blank"
          className="bg-red-900/20 border border-red-500/30 rounded-lg p-3 text-center text-xs text-red-400 hover:border-red-500 transition-colors"
        >
          Full xSTM Flags
          <div className="text-slate-500 mt-0.5">$0.01 via x402</div>
        </a>
        <a
          href={`${API}/api/v1/tickers/${ticker}/flow`}
          target="_blank"
          className="bg-cyan-900/20 border border-cyan-500/30 rounded-lg p-3 text-center text-xs text-cyan-400 hover:border-cyan-500 transition-colors"
        >
          Full xIFD Flow
          <div className="text-slate-500 mt-0.5">$0.01 via x402</div>
        </a>
      </div>
    </div>
  );
}

function StatCard({
  label, value, sub, valueClass = 'text-white', href,
}: {
  label: string;
  value: string;
  sub: string;
  valueClass?: string;
  href?: string;
}) {
  const inner = (
    <div className="bg-xmit-surface border border-xmit-border rounded-xl p-4">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${valueClass}`}>{value}</div>
      <div className="text-xs text-slate-600 mt-1">{sub}</div>
    </div>
  );
  return href ? <a href={href}>{inner}</a> : inner;
}
