import { Suspense } from 'react';
import { HealthScoreCard } from '@/components/HealthScoreCard';
import { FindingCard } from '@/components/FindingCard';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'https://xaap.scriptmasterlabs.com';

async function getStats() {
  try {
    const r = await fetch(`${API}/api/v1/status`, { next: { revalidate: 60 } });
    return r.ok ? r.json<{ stats: { auditors: number; validated_findings: number; tickers_covered: number } }>() : null;
  } catch { return null; }
}

async function getTopTickers() {
  try {
    const r = await fetch(`${API}/api/v1/tickers?limit=12`, { next: { revalidate: 120 } });
    return r.ok ? r.json<{ tickers: Array<{ symbol: string; company_name: string; health_grade: string; health_score: number; red_flag_count: number; severe_flag_count: number }> }>() : null;
  } catch { return null; }
}

async function getLeaders() {
  try {
    const r = await fetch(`${API}/api/v1/auditors?limit=5`, { next: { revalidate: 120 } });
    return r.ok ? r.json<{ auditors: Array<{ address: string; display_name: string; tier: string; reputation_score: number; validated_findings: number }> }>() : null;
  } catch { return null; }
}

export default async function HomePage() {
  const [stats, tickerData, leaderData] = await Promise.all([getStats(), getTopTickers(), getLeaders()]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">

      {/* Hero */}
      <div className="text-center mb-16">
        <div className="inline-flex items-center gap-2 bg-xaap-red/10 border border-xaap-red/30 rounded-full px-4 py-1.5 text-xs text-xaap-red mb-6 mono">
          ⚡ Live on Base Mainnet · x402 Protocol
        </div>
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight mb-4">
          The Decentralized<br />
          <span className="text-xaap-red">Audit Institution</span>
        </h1>
        <p className="text-lg text-xaap-muted max-w-2xl mx-auto mb-8">
          Researchers discover corporate fraud and sell verified evidence via micropayments.
          No custody. No SEC/CFTC. No Big-4 monopoly. Pure adversarial truth.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <a href="/submit"
            className="bg-xaap-red text-white px-6 py-3 rounded-lg font-semibold hover:bg-xaap-red/90 transition-colors">
            Submit a Finding
          </a>
          <a href="/leaderboard"
            className="bg-xaap-surface border border-xaap-border text-white px-6 py-3 rounded-lg font-semibold hover:bg-xaap-border/50 transition-colors">
            View Leaderboard
          </a>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-4 mb-16 max-w-2xl mx-auto">
          {[
            { label: 'Auditors', value: stats.stats.auditors.toLocaleString() },
            { label: 'Validated Findings', value: stats.stats.validated_findings.toLocaleString() },
            { label: 'Tickers Covered', value: stats.stats.tickers_covered.toLocaleString() },
          ].map(({ label, value }) => (
            <div key={label} className="bg-xaap-surface border border-xaap-border rounded-xl p-4 text-center">
              <div className="text-2xl font-bold mono">{value}</div>
              <div className="text-xs text-xaap-muted mt-1">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Ticker Grid */}
      {tickerData?.tickers && tickerData.tickers.length > 0 && (
        <section className="mb-16">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold">Corporate Health Scorecards</h2>
            <a href="/tickers" className="text-sm text-xaap-muted hover:text-white transition-colors">View all →</a>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {tickerData.tickers.map(t => (
              <HealthScoreCard key={t.symbol} ticker={t} />
            ))}
          </div>
        </section>
      )}

      {/* Leaderboard preview */}
      {leaderData?.auditors && leaderData.auditors.length > 0 && (
        <section className="mb-16">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold">Top Auditors</h2>
            <a href="/leaderboard" className="text-sm text-xaap-muted hover:text-white transition-colors">Full leaderboard →</a>
          </div>
          <div className="bg-xaap-surface border border-xaap-border rounded-xl overflow-hidden">
            {leaderData.auditors.map((a, i) => (
              <a key={a.address} href={`/auditor/${a.address}`}
                className="flex items-center justify-between px-5 py-4 border-b border-xaap-border last:border-0 hover:bg-xaap-border/20 transition-colors">
                <div className="flex items-center gap-4">
                  <span className="text-xaap-muted mono text-sm w-5">#{i + 1}</span>
                  <div>
                    <div className="font-medium">{a.display_name ?? `${a.address.slice(0, 6)}...${a.address.slice(-4)}`}</div>
                    <div className={`text-xs tier-${a.tier.toLowerCase().replace('_', '-')}`}>{a.tier}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold mono">{a.reputation_score.toFixed(1)}</div>
                  <div className="text-xs text-xaap-muted">{a.validated_findings} validated</div>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* How it works */}
      <section className="mb-16">
        <h2 className="text-xl font-bold mb-8 text-center">Zero-Custody Architecture</h2>
        <div className="grid sm:grid-cols-3 gap-6">
          {[
            {
              step: '01', title: 'Discover', icon: '🔍',
              desc: 'Auditors analyze free public SEC EDGAR filings, court records, satellite data, and job postings to find red flags.',
            },
            {
              step: '02', title: 'Verify', icon: '⚖️',
              desc: 'Findings are reviewed by a staked jury panel. Evidence hash is stored on Base. Accuracy is tracked on-chain forever.',
            },
            {
              step: '03', title: 'Earn', icon: '💰',
              desc: 'Buyers pay $0.01–$25 USDC via x402. 70% goes to the auditor instantly. Reputation compounds with every validated finding.',
            },
          ].map(({ step, title, icon, desc }) => (
            <div key={step} className="bg-xaap-surface border border-xaap-border rounded-xl p-6">
              <div className="text-3xl mb-3">{icon}</div>
              <div className="text-xaap-muted mono text-xs mb-1">{step}</div>
              <h3 className="font-bold text-lg mb-2">{title}</h3>
              <p className="text-sm text-xaap-muted leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* AI Agent CTA */}
      <section className="bg-gradient-to-r from-xaap-red/10 to-purple-900/20 border border-xaap-red/20 rounded-2xl p-8 text-center">
        <h2 className="text-2xl font-bold mb-3">Built for AI Agents</h2>
        <p className="text-xaap-muted max-w-xl mx-auto mb-6">
          xAAP is a native MCP server. Claude, GPT, Gemini, and Perplexity can query forensic data
          and pay via x402 automatically. Register your agent to earn 15% affiliate fees.
        </p>
        <div className="font-mono text-sm bg-black/40 rounded-lg p-4 max-w-lg mx-auto text-left mb-6">
          <span className="text-xaap-muted">{'//'} MCP config</span><br />
          {'{'}<br />
          &nbsp;&nbsp;<span className="text-blue-400">"mcpServers"</span>: {'{'}<br />
          &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-green-400">"xaap"</span>: {'{'}<br />
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span className="text-yellow-400">"url"</span>: <span className="text-orange-300">"https://xaap.scriptmasterlabs.com/mcp"</span><br />
          &nbsp;&nbsp;&nbsp;&nbsp;{'}'}<br />
          &nbsp;&nbsp;{'}'}<br />
          {'}'}
        </div>
        <a href="/api/v1/agents/manifest.json"
          className="inline-flex items-center gap-2 bg-xaap-red text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-xaap-red/90 transition-colors">
          Register Your Agent →
        </a>
      </section>
    </div>
  );
}
