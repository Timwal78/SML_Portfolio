'use client';

interface Props {
  ticker: {
    symbol: string;
    company_name: string;
    health_grade: string;
    health_score: number;
    red_flag_count: number;
    severe_flag_count: number;
  };
}

const GRADE_COLORS: Record<string, string> = {
  'A+': '#00C853', A: '#69F0AE', B: '#FFD740',
  C: '#FF9100', D: '#FF5722', F: '#FF1744', PENDING: '#6B6B8A',
};

export function HealthScoreCard({ ticker }: Props) {
  const color = GRADE_COLORS[ticker.health_grade] ?? '#6B6B8A';

  return (
    <a href={`/ticker/${ticker.symbol}`}
      className="bg-xaap-surface border border-xaap-border rounded-xl p-4 hover:border-xaap-muted transition-colors block group">
      <div className="flex items-center justify-between mb-2">
        <span className="font-bold mono text-sm">{ticker.symbol}</span>
        <span className="font-black text-xl" style={{ color }}>{ticker.health_grade}</span>
      </div>
      <div className="text-xs text-xaap-muted truncate mb-3">{ticker.company_name}</div>

      {/* Score bar */}
      <div className="h-1.5 bg-xaap-border rounded-full overflow-hidden mb-3">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${ticker.health_score}%`, backgroundColor: color }}
        />
      </div>

      <div className="flex justify-between text-xs">
        <span className="text-xaap-muted">{ticker.red_flag_count} flags</span>
        {ticker.severe_flag_count > 0 && (
          <span className="text-xaap-red">{ticker.severe_flag_count} severe</span>
        )}
      </div>

      <div className="mt-3 text-xs text-xaap-muted group-hover:text-white transition-colors">
        View findings →
      </div>
    </a>
  );
}
