'use client';

interface Props {
  finding: {
    id: string;
    title: string;
    summary: string;
    severity: string;
    category: string;
    created_at: number;
  };
  ticker: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: '#FF1744', HIGH: '#FF5722', MEDIUM: '#FF9100', LOW: '#FFD740',
};

const CATEGORY_LABELS: Record<string, string> = {
  RELATED_PARTY: 'Related Party', AUDITOR_CHANGE: 'Auditor Change',
  GOING_CONCERN: 'Going Concern', REVENUE_RECOGNITION: 'Revenue Recognition',
  EXECUTIVE_COMP: 'Exec Comp', SUBSIDIARY: 'Subsidiary',
  INSIDER_TRADING: 'Insider Trading', OTHER: 'Other',
};

export function FindingCard({ finding, ticker }: Props) {
  const color = SEVERITY_COLORS[finding.severity] ?? '#6B6B8A';
  const date = new Date(finding.created_at * 1000).toLocaleDateString();

  return (
    <div className="bg-xaap-surface border border-xaap-border rounded-xl p-5 hover:border-xaap-muted transition-colors">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-xs font-bold px-2 py-0.5 rounded border mono"
            style={{ color, borderColor: `${color}40`, backgroundColor: `${color}10` }}>
            {finding.severity}
          </span>
          <span className="text-xs text-xaap-muted bg-xaap-border/50 px-2 py-0.5 rounded">
            {CATEGORY_LABELS[finding.category] ?? finding.category}
          </span>
        </div>
        <span className="text-xs text-xaap-muted shrink-0">{date}</span>
      </div>

      <h3 className="font-semibold mb-2 leading-snug">{finding.title}</h3>
      <p className="text-sm text-xaap-muted leading-relaxed">{finding.summary}</p>

      <a href={`/finding/${finding.id}`}
        className="mt-4 inline-flex items-center gap-1 text-xs text-xaap-muted hover:text-white transition-colors">
        Full thesis ($0.01 USDC) →
      </a>
    </div>
  );
}
