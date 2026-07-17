'use client';
import { useState } from 'react';

const CATEGORIES = [
  'RELATED_PARTY', 'AUDITOR_CHANGE', 'GOING_CONCERN',
  'REVENUE_RECOGNITION', 'EXECUTIVE_COMP', 'SUBSIDIARY',
  'INSIDER_TRADING', 'OTHER',
];
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export default function SubmitPage() {
  const [form, setForm] = useState({
    ticker: '', auditor_address: '', title: '', summary: '',
    full_thesis: '', severity: 'MEDIUM', category: 'OTHER',
    price_usdc: '1000000', filing_accession: '',
  });
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [result, setResult] = useState<string>('');

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('submitting');
    try {
      const r = await fetch('/api/v1/findings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await r.json<{ id?: string; error?: string }>();
      if (!r.ok) throw new Error(data.error ?? 'Submission failed');
      setStatus('success');
      setResult(data.id ?? '');
    } catch (e: unknown) {
      setStatus('error');
      setResult(e instanceof Error ? e.message : 'Unknown error');
    }
  }

  if (status === 'success') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <div className="text-5xl mb-4">🎯</div>
        <h1 className="text-2xl font-bold mb-2">Finding Submitted</h1>
        <p className="text-xaap-muted mb-4">Your finding is pending jury review.</p>
        <code className="text-xs text-xaap-muted bg-xaap-surface border border-xaap-border rounded px-3 py-1.5 block">
          ID: {result}
        </code>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="text-2xl font-bold mb-2">Submit Forensic Finding</h1>
      <p className="text-xaap-muted text-sm mb-8">
        All findings are sourced from free public data only (SEC EDGAR, court records, etc.).
        No investment advice. Researchers sell information.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Ticker" value={form.ticker} onChange={v => set('ticker', v.toUpperCase())} placeholder="AAPL" required />
          <Field label="Your Wallet Address" value={form.auditor_address} onChange={v => set('auditor_address', v)} placeholder="0x..." required />
        </div>

        <Field label="Title" value={form.title} onChange={v => set('title', v)}
          placeholder="Undisclosed related-party loan to CFO detected" required />

        <TextArea label="Public Summary (shown free)" value={form.summary} onChange={v => set('summary', v)}
          placeholder="2-3 sentence preview of the finding" required rows={3} />

        <TextArea label="Full Thesis (paid access)" value={form.full_thesis} onChange={v => set('full_thesis', v)}
          placeholder="Complete forensic analysis with evidence references, EDGAR filing links, cross-referenced entity data..."
          required rows={10} />

        <div className="grid grid-cols-2 gap-4">
          <SelectField label="Severity" value={form.severity} onChange={v => set('severity', v)} options={SEVERITIES} />
          <SelectField label="Category" value={form.category} onChange={v => set('category', v)} options={CATEGORIES} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Price (USDC, 6 decimals)" value={form.price_usdc} onChange={v => set('price_usdc', v)}
            placeholder="1000000 = $1.00" />
          <Field label="SEC Accession # (optional)" value={form.filing_accession}
            onChange={v => set('filing_accession', v)} placeholder="0000000000-00-000000" />
        </div>

        {status === 'error' && (
          <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">{result}</div>
        )}

        <button type="submit" disabled={status === 'submitting'}
          className="w-full bg-xaap-red text-white py-3 rounded-lg font-semibold hover:bg-xaap-red/90 transition-colors disabled:opacity-50">
          {status === 'submitting' ? 'Submitting...' : 'Submit Finding →'}
        </button>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, required = false }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs text-xaap-muted mb-1.5">{label}</label>
      <input
        value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} required={required}
        className="w-full bg-xaap-surface border border-xaap-border rounded-lg px-3 py-2 text-sm focus:border-xaap-muted outline-none transition-colors"
      />
    </div>
  );
}

function TextArea({ label, value, onChange, placeholder, required = false, rows = 4 }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; required?: boolean; rows?: number;
}) {
  return (
    <div>
      <label className="block text-xs text-xaap-muted mb-1.5">{label}</label>
      <textarea
        value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} required={required} rows={rows}
        className="w-full bg-xaap-surface border border-xaap-border rounded-lg px-3 py-2 text-sm focus:border-xaap-muted outline-none transition-colors resize-y font-mono"
      />
    </div>
  );
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[];
}) {
  return (
    <div>
      <label className="block text-xs text-xaap-muted mb-1.5">{label}</label>
      <select
        value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-xaap-surface border border-xaap-border rounded-lg px-3 py-2 text-sm focus:border-xaap-muted outline-none transition-colors">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
