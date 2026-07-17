import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Auditor Leaderboard — xAAP' };

const API = process.env.NEXT_PUBLIC_API_URL ?? 'https://xaap.scriptmasterlabs.com';

const TIER_STYLES: Record<string, string> = {
  GRAND_INQUISITOR: 'text-pink-400 bg-pink-400/10',
  AUDITOR:          'text-purple-400 bg-purple-400/10',
  INVESTIGATOR:     'text-cyan-400 bg-cyan-400/10',
  DETECTIVE:        'text-green-400 bg-green-400/10',
  CITIZEN:          'text-xaap-muted bg-xaap-border/30',
};

export default async function LeaderboardPage() {
  let auditors: Array<{
    address: string; display_name: string; tier: string;
    reputation_score: number; accuracy_rate: number;
    total_findings: number; validated_findings: number;
    streak_days: number; total_earned_usdc: string;
  }> = [];
  try {
    const r = await fetch(`${API}/api/v1/auditors?limit=100`, { next: { revalidate: 120 } });
    if (r.ok) ({ auditors } = await r.json());
  } catch {}

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Auditor Leaderboard</h1>
        <p className="text-xaap-muted">Ranked by reputation score. Accuracy and streak multiplier compound forever.</p>
      </div>

      {auditors.length === 0 ? (
        <div className="text-center py-20 text-xaap-muted">
          No auditors yet. <a href="/submit" className="text-xaap-red hover:underline">Be the first.</a>
        </div>
      ) : (
        <div className="bg-xaap-surface border border-xaap-border rounded-xl overflow-hidden">
          <div className="grid grid-cols-12 text-xs text-xaap-muted px-5 py-3 border-b border-xaap-border">
            <div className="col-span-1">#</div>
            <div className="col-span-4">Auditor</div>
            <div className="col-span-2 text-right">Rep Score</div>
            <div className="col-span-2 text-right">Accuracy</div>
            <div className="col-span-2 text-right">Findings</div>
            <div className="col-span-1 text-right">Streak</div>
          </div>
          {auditors.map((a, i) => (
            <a key={a.address} href={`/auditor/${a.address}`}
              className="grid grid-cols-12 items-center px-5 py-4 border-b border-xaap-border last:border-0 hover:bg-xaap-border/20 transition-colors">
              <div className="col-span-1 text-xaap-muted mono text-sm">{i + 1}</div>
              <div className="col-span-4">
                <div className="font-medium truncate">
                  {a.display_name ?? `${a.address.slice(0, 8)}...${a.address.slice(-4)}`}
                </div>
                <span className={`text-xs px-1.5 py-0.5 rounded mono ${TIER_STYLES[a.tier] ?? ''}`}>
                  {a.tier}
                </span>
              </div>
              <div className="col-span-2 text-right mono font-bold">{a.reputation_score.toFixed(1)}</div>
              <div className="col-span-2 text-right">{(a.accuracy_rate * 100).toFixed(1)}%</div>
              <div className="col-span-2 text-right">{a.validated_findings}/{a.total_findings}</div>
              <div className="col-span-1 text-right mono">{a.streak_days}d</div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
