interface ScoreCache {
  score: number;
  fetchedAt: number;
}

const SCORE_CACHE_TTL = 300_000; // 5 minutes

export class CreditBureau {
  private static instance: CreditBureau;
  private readonly cache = new Map<string, ScoreCache>();
  private readonly baseUrl: string;

  private constructor() {
    this.baseUrl = process.env['PROOF402_URL'] ?? 'https://four02proof.onrender.com';
  }

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

    try {
      const res = await fetch(`${this.baseUrl}/v1/score/${wallet}`, {
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        const body = (await res.json()) as { score: number };
        this.cache.set(wallet, { score: body.score, fetchedAt: now });
        return body.score;
      }
    } catch {
      // Fall through to default
    }

    // Default score for new/unknown agents
    const defaultScore = 300;
    this.cache.set(wallet, { score: defaultScore, fetchedAt: now });
    return defaultScore;
  }

  async incrementScore(wallet: string, delta: number): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/v1/score/${wallet}/increment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta }),
      });
      // Invalidate cache
      this.cache.delete(wallet);
    } catch {
      // Non-fatal
    }
  }
}
