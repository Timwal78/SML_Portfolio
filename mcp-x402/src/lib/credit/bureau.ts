interface ScoreCache {
  score: number;
  grade: string;
  fetchedAt: number;
}

const SCORE_CACHE_TTL = 300_000; // 5 minutes

// Dedicated Agent Credit Bureau (primary) — FICO 300-850 for XRPL wallets
const BUREAU_PRIMARY = process.env['AGENT_CREDIT_BUREAU_URL'] ?? 'https://sml-agent-credit-bureau.onrender.com';
// 402Proof (fallback) — legacy endpoint
const BUREAU_FALLBACK = process.env['PROOF402_URL'] ?? 'https://four02proof.onrender.com';

export class CreditBureau {
  private static instance: CreditBureau;
  private readonly cache = new Map<string, ScoreCache>();

  private constructor() {}

  static getInstance(): CreditBureau {
    if (!CreditBureau.instance) {
      CreditBureau.instance = new CreditBureau();
    }
    return CreditBureau.instance;
  }

  async getScore(wallet: string): Promise<number> {
    const now = Date.now();
    const cached = this.cache.get(wallet);

    if (cached && now - cached.fetchedAt < SCORE_CACHE_TTL) {
      return cached.score;
    }

    // Try dedicated Agent Credit Bureau first
    try {
      const res = await fetch(
        `${BUREAU_PRIMARY}/v1/agent/score?wallet=${encodeURIComponent(wallet)}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const body = (await res.json()) as { score: number; grade: string };
        this.cache.set(wallet, { score: body.score, grade: body.grade ?? 'D', fetchedAt: now });
        return body.score;
      }
    } catch {
      // Fall through to legacy endpoint
    }

    // Fallback: 402Proof legacy endpoint
    try {
      const res = await fetch(`${BUREAU_FALLBACK}/v1/score/${wallet}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const body = (await res.json()) as { score: number };
        this.cache.set(wallet, { score: body.score, grade: 'D', fetchedAt: now });
        return body.score;
      }
    } catch {
      // Fall through to default
    }

    // Default score for new/unknown agents
    const defaultScore = 300;
    this.cache.set(wallet, { score: defaultScore, grade: 'D', fetchedAt: now });
    return defaultScore;
  }

  async getFullScore(wallet: string): Promise<{ score: number; grade: string; risk: string; creditLimit: number; cached: boolean }> {
    try {
      const res = await fetch(
        `${BUREAU_PRIMARY}/v1/agent/score?wallet=${encodeURIComponent(wallet)}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const body = (await res.json()) as { score: number; grade: string; risk: string; creditLimit: number; cached: boolean };
        this.cache.set(wallet, { score: body.score, grade: body.grade, fetchedAt: Date.now() });
        return body;
      }
    } catch {
      // Fall through
    }
    const score = await this.getScore(wallet);
    return { score, grade: 'D', risk: 'VERY_HIGH', creditLimit: 0, cached: false };
  }

  async incrementScore(wallet: string, delta: number): Promise<void> {
    try {
      // Notify legacy endpoint (bureau doesn't expose increment — it reads from XRPL)
      await fetch(`${BUREAU_FALLBACK}/v1/score/${wallet}/increment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta }),
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // Non-fatal
    }
    this.cache.delete(wallet);
  }
}
