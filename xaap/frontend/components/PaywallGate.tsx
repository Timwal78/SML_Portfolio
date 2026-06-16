'use client';
import { useState } from 'react';

interface Props { ticker: string; }

export function PaywallGate({ ticker }: Props) {
  const [loading, setLoading] = useState(false);
  const [paid, setPaid] = useState(false);
  const [findings, setFindings] = useState<unknown[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handlePay() {
    setLoading(true);
    setError(null);
    try {
      // First call without payment — get 402 response with payment requirements
      const challenge = await fetch(`/api/v1/tickers/${ticker}/findings`);
      if (challenge.status !== 402) {
        // Already paid or free
        const data = await challenge.json<{ findings: unknown[] }>();
        setFindings(data.findings ?? []);
        setPaid(true);
        return;
      }

      const requirements = await challenge.json<{ accepts: Array<{ maxAmountRequired: string; payTo: string; asset: string }> }>();
      const req = requirements.accepts[0];
      if (!req) throw new Error('No payment requirements');

      // Open wallet connection to pay
      // In production: integrate with wagmi/viem to send USDC on Base
      // For demo: show payment instructions
      setError(`To access real-time findings for ${ticker}, pay ${Number(req.maxAmountRequired) / 1e6} USDC on Base to:\n${req.payTo}\n\nUse the MCP endpoint or x402-fetch SDK for automated agent payments.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Payment failed');
    } finally {
      setLoading(false);
    }
  }

  if (paid && findings.length > 0) {
    return (
      <div className="space-y-3">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <span className="bg-xaap-red/10 text-xaap-red text-xs px-2 py-0.5 rounded">LIVE</span>
          Real-Time Findings
        </h2>
        {(findings as Array<{ id: string; title: string; summary: string; severity: string; category: string; created_at: number }>).map(f => (
          <div key={f.id} className="bg-xaap-surface border border-xaap-border rounded-xl p-4">
            <div className="font-semibold mb-1">{f.title}</div>
            <div className="text-sm text-xaap-muted">{f.summary}</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="bg-xaap-surface border border-dashed border-xaap-border rounded-xl p-8 text-center">
      <div className="text-4xl mb-3">🔒</div>
      <h3 className="font-bold text-lg mb-2">Real-Time Findings</h3>
      <p className="text-xaap-muted text-sm mb-6 max-w-sm mx-auto">
        Access all live forensic findings for {ticker} with a one-time
        micropayment of <strong className="text-white">$0.01 USDC</strong> on Base.
        No subscription. No account required.
      </p>

      {error && (
        <div className="bg-xaap-border/30 rounded-lg p-3 text-xs text-xaap-muted mono mb-4 text-left whitespace-pre-wrap">{error}</div>
      )}

      <button
        onClick={handlePay}
        disabled={loading}
        className="bg-xaap-red text-white px-6 py-2.5 rounded-lg font-semibold hover:bg-xaap-red/90 transition-colors disabled:opacity-50">
        {loading ? 'Connecting...' : 'Pay $0.01 USDC → View Findings'}
      </button>

      <p className="text-xs text-xaap-muted mt-4">
        AI agents: use <code className="text-white">X-Payment</code> header with x402 proof
      </p>
    </div>
  );
}
