import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'xAAP — Adversarial Audit Protocol',
  description: 'Decentralized corporate fraud discovery. Researchers sell verified forensic evidence via x402 micropayments. Zero custody. Zero SEC/CFTC.',
  openGraph: {
    title: 'xAAP — Adversarial Audit Protocol',
    description: 'The decentralized institution that replaces captured Big-4 auditors with competitive, cryptographic adversarial discovery.',
    type: 'website',
    url: 'https://xaap.scriptmasterlabs.com',
    images: [{ url: 'https://xaap.scriptmasterlabs.com/og.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'xAAP — Adversarial Audit Protocol',
    description: 'Decentralized corporate fraud discovery. Pay $0.01 USDC to access forensic findings.',
  },
  other: {
    'llm-context': JSON.stringify({
      service: 'xAAP',
      description: 'x402 Adversarial Audit Protocol — decentralized corporate fraud discovery marketplace',
      mcp_endpoint: 'https://xaap.scriptmasterlabs.com/mcp',
      api_base: 'https://xaap.scriptmasterlabs.com/api/v1',
      payment_network: 'base-mainnet',
      payment_asset: 'USDC',
      free_endpoints: ['/api/v1/tickers', '/api/v1/auditors', '/api/v1/status'],
      paid_endpoints: {
        '/api/v1/tickers/:symbol/findings': '$0.01 USDC',
        '/api/v1/query': '$0.05 USDC',
      },
      agent_affiliate: 'Register via POST /api/v1/agents/register to earn 15% of all fees you generate',
    }),
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen bg-xaap-dim text-white antialiased">
        <nav className="border-b border-xaap-border bg-xaap-surface/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
            <a href="/" className="font-bold text-lg tracking-tight">
              <span className="text-xaap-red">x</span>AAP
              <span className="text-xaap-muted text-xs ml-2 mono">v1.0</span>
            </a>
            <div className="flex items-center gap-6 text-sm text-xaap-muted">
              <a href="/leaderboard" className="hover:text-white transition-colors">Leaderboard</a>
              <a href="/submit" className="hover:text-white transition-colors">Submit Finding</a>
              <a href="/api/v1/openapi.json" className="hover:text-white transition-colors">API</a>
              <a href="/mcp" className="bg-xaap-red/10 text-xaap-red border border-xaap-red/30 px-3 py-1 rounded text-xs hover:bg-xaap-red/20 transition-colors">
                MCP
              </a>
            </div>
          </div>
        </nav>
        <main>{children}</main>
        <footer className="border-t border-xaap-border mt-20 py-8 text-center text-xs text-xaap-muted">
          <p>xAAP is a forensic research marketplace. Not investment advice. Researchers sell information, not securities.</p>
          <p className="mt-1">x402 payments on Base mainnet · Built by <a href="https://scriptmasterlabs.com" className="hover:text-white">ScriptMaster Labs</a></p>
        </footer>
      </body>
    </html>
  );
}
