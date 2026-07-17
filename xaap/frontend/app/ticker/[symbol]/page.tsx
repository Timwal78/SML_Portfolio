import { FindingCard } from '@/components/FindingCard';
import { PaywallGate } from '@/components/PaywallGate';
import type { Metadata } from 'next';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'https://xaap.scriptmasterlabs.com';

interface TickerData {
  symbol: string;
  company_name: string;
  health_grade: string;
  health_score: number;
  red_flag_count: number;
  severe_flag_count: number;
  auditor_count: number;
  free_findings: Array<{
    id: string; title: string; summary: string;
    severity: string; category: string; created_at: number;
  }>;
}

export async function generateMetadata({ params }: { params: { symbol: string } }): Promise<Metadata> {
  const symbol = params.symbol.toUpperCase();
  return {
    title: `${symbol} Forensic Audit — xAAP`,
    description: `Corporate health score and forensic findings for ${symbol}. Powered by xAAP adversarial audit protocol.`,
    openGraph: {
      title: `${symbol} — xAAP Forensic Audit`,
      description: `See what auditors have found on ${symbol}. Verified forensic findings, red flags, and corporate health score.`,
    },
  };
}

export default async function TickerPage({ params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase();

  let ticker: TickerData | null = null;
  try {
    const r = await fetch(`${API}/api/v1/tickers/${symbol}`, { next: { revalidate: 300 } });
    if (r.ok) ticker = await r.json();
  } catch {}

  if (!ticker) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <div className="text-6xl mb-4">🔍</div>
        <h1 className="text-2xl font-bold mb-2">{symbol} not found</h1>
        <p className="text-xaap-muted">No audit coverage yet. <a href="/submit" className="text-xaap-red hover:underline">Submit the first finding.</a></p>
      </div>
    );
  }

  const gradeColor = {
    'A+': 'text-green-400', A: 'text-green-300', B: 'text-yellow-300',
    C: 'text-orange-400', D: 'text-orange-500', F: 'text-red-500', PENDING: 'text-xaap-muted',
  }[ticker.health_grade] ?? 'text-xaap-muted';

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-3xl font-bold mono">{ticker.symbol}</h1>
            <span className={`text-4xl font-black ${gradeColor}`}>{ticker.health_grade}</span>
          </div>
          <p className="text-xaap-muted">{ticker.company_name}</p>
        </div>
        <div className="text-right">
          <div className="text-sm text-xaap-muted">Health Score</div>
          <div className="text-3xl font-black mono">{ticker.health_score.toFixed(0)}<span className="text-xaap-muted text-lg">/100</span></div>
        </div>
      </div>

      {/* Red flag summary */}
      <div className="grid grid-cols-3 gap-4 mb-10">
        <div className="bg-xaap-surface border border-xaap-border rounded-xl p-4 text-center">
          <div className="text-2xl font-bold mono text-xaap-red">{ticker.red_flag_count}</div>
          <div className="text-xs text-xaap-muted mt-1">Total Red Flags</div>
        </div>
        <div className="bg-xaap-surface border border-xaap-border rounded-xl p-4 text-center">
          <div className="text-2xl font-bold mono text-orange-500">{ticker.severe_flag_count}</div>
          <div className="text-xs text-xaap-muted mt-1">HIGH/CRITICAL</div>
        </div>
        <div className="bg-xaap-surface border border-xaap-border rounded-xl p-4 text-center">
          <div className="text-2xl font-bold mono">{ticker.auditor_count}</div>
          <div className="text-xs text-xaap-muted mt-1">Auditors</div>
        </div>
      </div>

      {/* Free findings */}
      {ticker.free_findings.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <span className="bg-xaap-green/10 text-xaap-green text-xs px-2 py-0.5 rounded">FREE</span>
            Top Findings <span className="text-xaap-muted text-sm font-normal">(48h delayed)</span>
          </h2>
          <div className="space-y-3">
            {ticker.free_findings.map(f => (
              <FindingCard key={f.id} finding={f} ticker={symbol} />
            ))}
          </div>
        </section>
      )}

      {/* Paywall gate */}
      <PaywallGate ticker={symbol} />
    </div>
  );
}
