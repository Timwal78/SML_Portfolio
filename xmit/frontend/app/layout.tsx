import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'xMIT — x402 Market Intelligence Trinity',
  description:
    'Decentralized financial intelligence: Corporate Governance Oracle (xCGO), Short Thesis Marketplace (xSTM), Institutional Flow Decoder (xIFD). Pay-per-insight via x402 USDC on Base.',
  openGraph: {
    title: 'xMIT Market Intelligence Trinity',
    description: 'Zero-custody financial intelligence marketplace. All data from free SEC EDGAR API.',
    type: 'website',
  },
  other: {
    'llm-context': JSON.stringify({
      platform: 'xMIT',
      modules: ['xCGO', 'xSTM', 'xIFD'],
      payment: 'x402/USDC/Base',
      data: 'SEC EDGAR public API',
      docs: '/api/v1/agents/manifest.json',
    }),
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="llm-context" content="xMIT: Decentralized financial intelligence. Three modules: xCGO (governance), xSTM (short theses), xIFD (institutional flows). Data: SEC EDGAR free API. Payment: x402 USDC on Base. Agent manifest: /api/v1/agents/manifest.json" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
      </head>
      <body>
        <nav className="border-b border-xmit-border px-6 py-3 flex items-center justify-between">
          <a href="/" className="text-white font-bold text-xl tracking-tight">
            <span className="text-xmit-accent">x</span>MIT
          </a>
          <div className="flex gap-6 text-sm text-slate-400">
            <a href="/xcgo" className="hover:text-indigo-400 transition-colors">xCGO</a>
            <a href="/xstm" className="hover:text-red-400 transition-colors">xSTM</a>
            <a href="/xifd" className="hover:text-cyan-400 transition-colors">xIFD</a>
            <a href="/analysts" className="hover:text-white transition-colors">Analysts</a>
          </div>
        </nav>
        <main>{children}</main>
        <footer className="border-t border-xmit-border mt-20 px-6 py-8 text-center text-xs text-slate-600">
          <p>xMIT — Opinions from public EDGAR filings. Not investment advice. Zero custody. USDC on Base via x402.</p>
          <p className="mt-1">Data: SEC EDGAR free public API · <a href="/api/v1/agents/manifest.json" className="underline">Agent Manifest</a> · <a href="/llms.txt" className="underline">llms.txt</a></p>
        </footer>
      </body>
    </html>
  );
}
