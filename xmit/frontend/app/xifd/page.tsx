'use client';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

interface WhaleMove {
  ticker: string;
  institution_name: string;
  action: string;
  change_pct: number | null;
  estimated_value_usd: number | null;
  filed_at: string;
}

const ACTION_STYLES: Record<string, string> = {
  NEW: 'bg-green-900/30 text-green-400 border-green-500/30',
  INCREASED: 'bg-emerald-900/30 text-emerald-400 border-emerald-500/30',
  DECREASED: 'bg-orange-900/30 text-orange-400 border-orange-500/30',
  EXITED: 'bg-red-900/30 text-red-400 border-red-500/30',
};

export default function XIFDPage() {
  const [movers, setMovers] = useState<WhaleMove[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/v1/whale-movers`)
      .then((r) => r.json())
      .then((d: { movers?: WhaleMove[] }) => setMovers(d.movers ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-cyan-400 text-2xl font-bold">xIFD</span>
        <h1 className="text-2xl font-bold text-white">Institutional Flow Decoder</h1>
      </div>
      <p className="text-slate-400 text-sm mb-8">
        Real-time parsing of SEC EDGAR 13F, 13D, Form 4, and N-PORT filings. Decodes where institutional money is moving — no exchange data licenses required.
      </p>

      <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
        🐳 Significant Moves (7 days)
      </h2>

      {loading ? (
        <div className="text-center text-slate-600 py-20">Loading…</div>
      ) : movers.length === 0 ? (
        <div className="bg-xmit-surface border border-xmit-border rounded-lg p-8 text-center text-slate-600">
          Awaiting first 13F/Form 4 filing ingestion. EDGAR polling runs every 60 seconds.
        </div>
      ) : (
        <div className="space-y-2">
          {movers.map((m, i) => (
            <div
              key={i}
              className="bg-xmit-surface border border-xmit-border rounded-lg p-4 flex items-center gap-4"
            >
              <a href={`/tickers/${m.ticker}`} className="font-bold text-white text-lg w-20 hover:text-cyan-400">
                ${m.ticker}
              </a>
              <div className="flex-1">
                <div className="text-slate-300 text-sm">{m.institution_name}</div>
                {m.estimated_value_usd && (
                  <div className="text-xs text-slate-500">
                    ~${(m.estimated_value_usd / 1_000_000).toFixed(1)}M
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`text-xs border rounded px-2 py-0.5 font-semibold ${
                    ACTION_STYLES[m.action] ?? 'text-slate-400 border-slate-600'
                  }`}
                >
                  {m.action}
                </span>
                {m.change_pct != null && (
                  <span
                    className={`text-sm font-semibold ${
                      m.change_pct >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    {m.change_pct >= 0 ? '+' : ''}{m.change_pct.toFixed(0)}%
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-600 w-24 text-right">
                {m.filed_at?.split('T')[0]}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-12 bg-xmit-surface border border-xmit-border rounded-xl p-6">
        <h3 className="font-semibold text-white mb-3">Loyalty Tiers — Flow Circle</h3>
        <div className="space-y-2 text-xs">
          {[
            ['SCOUT', 'Access 1 flow alert. Free delayed institutional data.', 'text-slate-400'],
            ['TRACKER', '50 alerts, 70% accuracy. Reduced fees, early EDGAR access.', 'text-blue-400'],
            ['HUNTER', 'Top 100. Premium pricing, custom filters, institutional invites.', 'text-purple-400'],
            ['WHALE', 'Hall of Fame. Lifetime revenue share, Bloomberg-style API access.', 'text-orange-400'],
          ].map(([tier, desc, color]) => (
            <div key={tier} className="flex gap-3">
              <span className={`font-bold w-20 shrink-0 ${color}`}>{tier}</span>
              <span className="text-slate-500">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
