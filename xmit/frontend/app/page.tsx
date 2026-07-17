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

interface ShortCandidate {
  ticker: string;
  total_flags: number;
  critical_flags: number;
  recent_activity: string;
}

export default function Home() {
  const [whales, setWhales] = useState<WhaleMove[]>([]);
  const [shorts, setShorts] = useState<ShortCandidate[]>([]);

  useEffect(() => {
    fetch(`${API}/api/v1/whale-movers`)
      .then((r) => r.json())
      .then((d: { movers?: WhaleMove[] }) => setWhales(d.movers ?? []))
      .catch(() => {});
    fetch(`${API}/api/v1/short-candidates`)
      .then((r) => r.json())
      .then((d: { candidates?: ShortCandidate[] }) => setShorts(d.candidates ?? []))
      .catch(() => {});
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-6 py-12">
      {/* Hero */}
      <div className="text-center mb-16">
        <div className="inline-block border border-xmit-accent/30 rounded-full px-4 py-1 text-xs text-xmit-accent mb-6">
          BUILT ON SEC EDGAR · x402 · BASE L2
        </div>
        <h1 className="text-5xl font-bold text-white mb-4">
          <span className="text-xmit-accent">x</span>MIT
        </h1>
        <p className="text-xl text-slate-400 mb-2">x402 Market Intelligence Trinity</p>
        <p className="text-slate-500 max-w-2xl mx-auto">
          Three-module decentralized financial intelligence platform. Analysts sell opinions derived
          from free public SEC EDGAR filings. Pay-per-insight via x402 micropayments (USDC on Base).
          Zero custody. Zero broker-dealer activity.
        </p>
        <div className="mt-6 flex flex-wrap gap-3 justify-center">
          <span className="bg-xmit-surface border border-xmit-border rounded px-3 py-1 text-xs text-slate-400">
            ✅ Zero Custody
          </span>
          <span className="bg-xmit-surface border border-xmit-border rounded px-3 py-1 text-xs text-slate-400">
            ✅ Free EDGAR Data
          </span>
          <span className="bg-xmit-surface border border-xmit-border rounded px-3 py-1 text-xs text-slate-400">
            ✅ x402 Micropayments
          </span>
          <span className="bg-xmit-surface border border-xmit-border rounded px-3 py-1 text-xs text-slate-400">
            ✅ On-Chain Reputation
          </span>
        </div>
      </div>

      {/* Module Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
        <ModuleCard
          id="xcgo"
          title="xCGO"
          subtitle="Corporate Governance Oracle"
          color="indigo"
          description="Decodes DEF 14A proxy statements. Governance grades, board effectiveness, CEO pay ratios, vote recommendations. Analysts earn USDC for accurate governance research."
          sources={['DEF 14A', 'Schedule 14A', 'Form 8-K']}
          priceFrom="$0.01"
          href="/xcgo"
        />
        <ModuleCard
          id="xstm"
          title="xSTM"
          subtitle="Short Thesis Marketplace"
          color="red"
          description="Adversarial research on public filings. Researchers publish red flag reports from EDGAR cross-referenced with court records, patents, corporate registries. They sell research, not positions."
          sources={['SEC EDGAR', 'CourtListener', 'OpenCorporates', 'USPTO']}
          priceFrom="$0.01"
          href="/xstm"
        />
        <ModuleCard
          id="xifd"
          title="xIFD"
          subtitle="Institutional Flow Decoder"
          color="cyan"
          description="Real-time 13F, 13D, Form 4 parsing. Decodes institutional accumulation and distribution. Insider clustering alerts. Smart money flow analysis without exchange data licenses."
          sources={['13F-HR', 'Form 4', '13D/13G', 'N-PORT']}
          priceFrom="$0.01"
          href="/xifd"
        />
      </div>

      {/* Live Data */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Whale Movers */}
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
            🐳 Whale Movers (7d)
          </h2>
          {whales.length === 0 ? (
            <div className="bg-xmit-surface border border-xmit-border rounded-lg p-6 text-center text-slate-600">
              Awaiting data
            </div>
          ) : (
            <div className="space-y-2">
              {whales.slice(0, 8).map((w, i) => (
                <div key={i} className="bg-xmit-surface border border-xmit-border rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <span className="font-bold text-white">{w.ticker}</span>
                    <span className="text-slate-500 text-xs ml-2">{w.institution_name}</span>
                  </div>
                  <div className="text-right">
                    <span
                      className={`text-sm font-semibold ${
                        w.action === 'NEW' || w.action === 'INCREASED'
                          ? 'text-xmit-green'
                          : 'text-xmit-red'
                      }`}
                    >
                      {w.action}
                    </span>
                    {w.change_pct != null && (
                      <span className="text-xs text-slate-500 ml-2">{w.change_pct.toFixed(0)}%</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Short Candidates */}
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
            🚩 Short Candidates (Open Red Flags)
          </h2>
          {shorts.length === 0 ? (
            <div className="bg-xmit-surface border border-xmit-border rounded-lg p-6 text-center text-slate-600">
              Awaiting data
            </div>
          ) : (
            <div className="space-y-2">
              {shorts.slice(0, 8).map((s, i) => (
                <a
                  key={i}
                  href={`/tickers/${s.ticker}`}
                  className="bg-xmit-surface border border-xmit-border hover:border-red-500/50 rounded-lg p-3 flex items-center justify-between transition-colors block"
                >
                  <span className="font-bold text-white">{s.ticker}</span>
                  <div className="text-right">
                    <span className="text-xmit-red text-sm font-semibold">{s.critical_flags} critical</span>
                    <span className="text-slate-500 text-xs ml-2">{s.total_flags} total</span>
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* For AI Agents */}
      <section className="mt-16 bg-xmit-surface border border-xmit-accent/30 rounded-xl p-8">
        <h2 className="text-lg font-bold text-white mb-2">For AI Agents</h2>
        <p className="text-slate-400 text-sm mb-4">
          xMIT is MCP-compatible. Register your agent, add <code className="bg-black px-1 rounded text-xmit-accent">X-AGENT-ID</code> to all requests, and earn 15% of protocol fees from traffic you drive.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
          <div className="bg-black rounded p-3">
            <div className="text-slate-500 mb-1"># Discover</div>
            <div className="text-xmit-green">GET /api/v1/agents/manifest.json</div>
          </div>
          <div className="bg-black rounded p-3">
            <div className="text-slate-500 mb-1"># Query (free)</div>
            <div className="text-xmit-green">GET /api/v1/tickers/AAPL</div>
          </div>
          <div className="bg-black rounded p-3">
            <div className="text-slate-500 mb-1"># Pay + get data</div>
            <div className="text-xmit-green">GET /api/v1/tickers/AAPL/flow</div>
            <div className="text-slate-500"># + X-PAYMENT header</div>
          </div>
        </div>
      </section>
    </div>
  );
}

function ModuleCard({
  title, subtitle, color, description, sources, priceFrom, href,
}: {
  id: string;
  title: string;
  subtitle: string;
  color: 'indigo' | 'red' | 'cyan';
  description: string;
  sources: string[];
  priceFrom: string;
  href: string;
}) {
  const borderClass = color === 'indigo' ? 'border-indigo-500/40 hover:border-indigo-500' :
    color === 'red' ? 'border-red-500/40 hover:border-red-500' :
    'border-cyan-500/40 hover:border-cyan-500';
  const titleClass = color === 'indigo' ? 'text-indigo-400' :
    color === 'red' ? 'text-red-400' : 'text-cyan-400';

  return (
    <a
      href={href}
      className={`bg-xmit-surface border-2 ${borderClass} rounded-xl p-6 block transition-colors group`}
    >
      <div className={`text-2xl font-bold ${titleClass} mb-1`}>{title}</div>
      <div className="text-white font-semibold mb-3 text-sm">{subtitle}</div>
      <p className="text-slate-400 text-xs leading-relaxed mb-4">{description}</p>
      <div className="flex flex-wrap gap-1 mb-4">
        {sources.map((s) => (
          <span key={s} className="bg-black rounded px-2 py-0.5 text-xs text-slate-500">{s}</span>
        ))}
      </div>
      <div className="text-xs text-slate-500">
        From <span className="text-xmit-green font-semibold">{priceFrom} USDC</span> via x402
      </div>
    </a>
  );
}
