'use client';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

interface Analyst {
  address: string;
  display_name: string | null;
  reputation_score: number;
  total_insights: number;
  tier: string;
  streak_days: number;
  total_purchases: number;
}

const TIER_COLORS: Record<string, string> = {
  CITIZEN: 'text-slate-400',
  DELEGATE: 'text-blue-400',
  SENATOR: 'text-purple-400',
  PRESIDENT: 'text-yellow-400',
  SOVEREIGN: 'text-orange-400',
};

export default function AnalystsPage() {
  const [analysts, setAnalysts] = useState<Analyst[]>([]);
  const [module, setModule] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const qs = module ? `?module=${module}` : '';
    fetch(`${API}/api/v1/analysts${qs}`)
      .then((r) => r.json())
      .then((d: { analysts?: Analyst[] }) => setAnalysts(d.analysts ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [module]);

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold text-white mb-2">Analyst Leaderboard</h1>
      <p className="text-slate-400 text-sm mb-8">
        Ranked by reputation score. Correct predictions compound reputation; wrong calls slash it.
      </p>

      <div className="flex gap-2 mb-6">
        {['', 'xcgo', 'xstm', 'xifd'].map((m) => (
          <button
            key={m}
            onClick={() => setModule(m)}
            className={`px-4 py-1.5 rounded text-xs font-semibold border transition-colors ${
              module === m
                ? 'border-xmit-accent bg-xmit-accent/10 text-xmit-accent'
                : 'border-xmit-border text-slate-400 hover:border-slate-500'
            }`}
          >
            {m === '' ? 'All Modules' : m.toUpperCase()}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center text-slate-600 py-20">Loading…</div>
      ) : analysts.length === 0 ? (
        <div className="text-center text-slate-600 py-20">No analysts yet. Be the first.</div>
      ) : (
        <div className="space-y-2">
          {analysts.map((a, i) => (
            <a
              key={a.address}
              href={`/analysts/${a.address}`}
              className="bg-xmit-surface border border-xmit-border hover:border-xmit-accent/50 rounded-lg p-4 flex items-center gap-4 transition-colors block"
            >
              <div className="text-slate-600 font-mono text-sm w-8 text-right">{i + 1}</div>
              <div className="flex-1">
                <div className="font-semibold text-white text-sm">
                  {a.display_name ?? `${a.address.slice(0, 6)}…${a.address.slice(-4)}`}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {a.total_insights} insights · {a.streak_days}d streak
                </div>
              </div>
              <div className="text-right">
                <div className={`text-xs font-bold ${TIER_COLORS[a.tier] ?? 'text-slate-400'}`}>
                  {a.tier}
                </div>
                <div className="text-white font-semibold">{a.reputation_score.toFixed(0)}</div>
                <div className="text-xs text-slate-500">rep</div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
