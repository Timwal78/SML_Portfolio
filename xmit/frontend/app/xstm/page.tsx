'use client';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

interface ShortCandidate {
  ticker: string;
  total_flags: number;
  critical_flags: number;
  recent_activity: string;
}

export default function XSTMPage() {
  const [candidates, setCandidates] = useState<ShortCandidate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/v1/short-candidates`)
      .then((r) => r.json())
      .then((d: { candidates?: ShortCandidate[] }) => setCandidates(d.candidates ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-red-400 text-2xl font-bold">xSTM</span>
        <h1 className="text-2xl font-bold text-white">Short Thesis Marketplace</h1>
      </div>
      <p className="text-slate-400 text-sm mb-4">
        Adversarial research from public EDGAR filings. Researchers publish red flag reports — they sell research, not short positions. Zero custody.
      </p>
      <div className="bg-red-900/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400/80 mb-8">
        ⚠️ All content is analyst opinion derived from publicly available SEC EDGAR filings. Not investment advice. No short positions are held or facilitated by xMIT.
      </div>

      <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
        Most Flagged Companies
      </h2>

      {loading ? (
        <div className="text-center text-slate-600 py-20">Loading…</div>
      ) : candidates.length === 0 ? (
        <div className="bg-xmit-surface border border-xmit-border rounded-lg p-8 text-center text-slate-600">
          No red flags detected yet. EDGAR polling starts on first deploy.
        </div>
      ) : (
        <div className="space-y-2">
          {candidates.map((c) => (
            <a
              key={c.ticker}
              href={`/tickers/${c.ticker}`}
              className="bg-xmit-surface border border-xmit-border hover:border-red-500/40 rounded-lg p-4 flex items-center gap-4 transition-colors block"
            >
              <span className="font-bold text-white text-lg w-20">${c.ticker}</span>
              <div className="flex-1 flex gap-6">
                <div>
                  <div className="text-red-400 font-semibold">{c.critical_flags}</div>
                  <div className="text-xs text-slate-500">critical</div>
                </div>
                <div>
                  <div className="text-orange-400 font-semibold">{c.total_flags}</div>
                  <div className="text-xs text-slate-500">total flags</div>
                </div>
              </div>
              <div className="text-xs text-slate-600">{c.recent_activity?.split('T')[0]}</div>
            </a>
          ))}
        </div>
      )}

      <div className="mt-12 bg-xmit-surface border border-xmit-border rounded-xl p-6">
        <h3 className="font-semibold text-white mb-3">Loyalty Tiers — Contrarian Circle</h3>
        <div className="space-y-2 text-xs">
          {[
            ['BEAR', 'Submit 1 thesis. Free basic red flag alerts.', 'text-slate-400'],
            ['GRIZZLY', '10 theses, 60% accuracy. Earn from paywall, early evidence access.', 'text-blue-400'],
            ['KODIAK', 'Top 100. Premium pricing, bounty eligibility, media partnerships.', 'text-purple-400'],
            ['LEGEND', 'Hall of Fame. Lifetime community bounty pool share.', 'text-orange-400'],
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
