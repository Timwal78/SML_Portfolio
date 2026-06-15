'use client';
import { useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

interface GovernanceScore {
  ticker: string;
  companyName: string;
  overallGrade: string;
  score: number;
  redFlagCount: number;
  proxyFilingDate: string;
  meetingDate: string | null;
  analystConsensus: string;
}

export default function XCGOPage() {
  const [ticker, setTicker] = useState('');
  const [result, setResult] = useState<GovernanceScore | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function lookup() {
    if (!ticker) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const r = await fetch(`${API}/api/v1/tickers/${ticker.toUpperCase()}/governance`);
      if (r.status === 402) {
        setError('Payment required ($0.01 USDC via x402). Use the API directly with X-PAYMENT header.');
        return;
      }
      if (!r.ok) { setError('No data for this ticker.'); return; }
      const d = await r.json() as GovernanceScore;
      setResult(d);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  const gradeColor = result
    ? result.overallGrade.startsWith('A') ? 'text-green-400'
      : result.overallGrade.startsWith('B') ? 'text-green-300'
      : result.overallGrade.startsWith('C') ? 'text-yellow-400'
      : result.overallGrade.startsWith('D') ? 'text-orange-400'
      : 'text-red-400'
    : 'text-white';

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-indigo-400 text-2xl font-bold">xCGO</span>
        <h1 className="text-2xl font-bold text-white">Corporate Governance Oracle</h1>
      </div>
      <p className="text-slate-400 text-sm mb-8">
        Decodes SEC EDGAR DEF 14A proxy statements. Governance grades, board effectiveness, CEO pay ratios, and vote recommendations — all from free public filings.
      </p>

      <div className="flex gap-3 mb-8">
        <input
          type="text"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && lookup()}
          placeholder="Ticker (e.g. AAPL, TSLA)"
          className="flex-1 bg-xmit-surface border border-xmit-border rounded-lg px-4 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
        />
        <button
          onClick={lookup}
          disabled={loading}
          className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-lg font-semibold text-sm disabled:opacity-50 transition-colors"
        >
          {loading ? 'Loading…' : 'Score'}
        </button>
      </div>

      {error && <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm mb-6">{error}</div>}

      {result && (
        <div className="bg-xmit-surface border border-indigo-500/30 rounded-xl p-6">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-white">${result.ticker}</h2>
              <p className="text-slate-400 text-sm">{result.companyName}</p>
            </div>
            <div className="text-right">
              <div className={`text-5xl font-bold ${gradeColor}`}>{result.overallGrade}</div>
              <div className="text-slate-500 text-xs mt-1">Score: {result.score.toFixed(0)}/100</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <InfoRow label="Red Flags" value={result.redFlagCount.toString()} />
            <InfoRow label="Proxy Filed" value={result.proxyFilingDate} />
            <InfoRow label="Meeting Date" value={result.meetingDate ?? '—'} />
            <InfoRow label="Analyst Consensus" value={result.analystConsensus} />
          </div>
          <div className="mt-4 pt-4 border-t border-xmit-border text-xs text-slate-500">
            Source: SEC EDGAR DEF 14A · Free public filing · Not investment advice
          </div>
        </div>
      )}

      <div className="mt-12 bg-xmit-surface border border-xmit-border rounded-xl p-6">
        <h3 className="font-semibold text-white mb-3">Loyalty Tiers — Governance Circle</h3>
        <div className="space-y-2 text-xs">
          {[
            ['CITIZEN', 'Connect wallet. Free delayed governance scores.', 'text-slate-400'],
            ['DELEGATE', '5 reports submitted. Earn from paywall, 3% protocol fee.', 'text-blue-400'],
            ['SENATOR', '20 reports, 80% accuracy. Premium pricing, early proxy access.', 'text-purple-400'],
            ['PRESIDENT', '50 reports, 85% accuracy. Revenue share, governance rights.', 'text-yellow-400'],
            ['SOVEREIGN', '100 reports, 90% accuracy. Hall of Fame, lifetime revenue share.', 'text-orange-400'],
          ].map(([tier, desc, color]) => (
            <div key={tier} className="flex gap-3">
              <span className={`font-bold w-24 shrink-0 ${color}`}>{tier}</span>
              <span className="text-slate-500">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black/30 rounded-lg p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-white font-semibold mt-0.5">{value}</div>
    </div>
  );
}
