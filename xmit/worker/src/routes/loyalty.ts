import { Hono } from 'hono';
import type { Env, LoyaltyTier } from '../types';

const TIER_THRESHOLDS: Record<LoyaltyTier, { insights: number; accuracy: number }> = {
  CITIZEN: { insights: 0, accuracy: 0 },
  DELEGATE: { insights: 5, accuracy: 0 },
  SENATOR: { insights: 20, accuracy: 80 },
  PRESIDENT: { insights: 50, accuracy: 85 },
  SOVEREIGN: { insights: 100, accuracy: 90 },
};

const loyalty = new Hono<{ Bindings: Env }>();

loyalty.get('/:address', async (c) => {
  const address = c.req.param('address');
  const row = await c.env.DB
    .prepare('SELECT * FROM analysts WHERE LOWER(address) = LOWER(?)')
    .bind(address)
    .first<Record<string, unknown>>();

  if (!row) {
    return c.json({
      address,
      tier: 'CITIZEN' as LoyaltyTier,
      tierBenefits: TIER_THRESHOLDS,
      reputationScore: 0,
      streakDays: 0,
      streakMultiplier: 1.0,
      nextTier: 'DELEGATE',
      nextTierRequirements: TIER_THRESHOLDS.DELEGATE,
      achievements: [],
    });
  }

  const streakDays = row.streak_days as number;
  const streakMultiplier =
    streakDays >= 100 ? 5.0 :
    streakDays >= 30 ? 2.5 :
    streakDays >= 7 ? 1.5 : 1.0;

  const currentTier = row.tier as LoyaltyTier;
  const tiers = Object.keys(TIER_THRESHOLDS) as LoyaltyTier[];
  const tierIdx = tiers.indexOf(currentTier);
  const nextTier = tiers[tierIdx + 1] ?? null;

  const achievements = await c.env.DB
    .prepare('SELECT * FROM achievements WHERE analyst_address = ? ORDER BY earned_at DESC')
    .bind(row.address)
    .all();

  return c.json({
    address: row.address,
    displayName: row.display_name,
    tier: currentTier,
    tierBenefits: {
      CITIZEN: 'Free delayed governance scores, 1 free recommendation/day',
      DELEGATE: 'Earn from paywall, reduced protocol fees (5% → 3%)',
      SENATOR: 'Premium pricing power, early proxy access, co-marketing',
      PRESIDENT: 'Protocol fee revenue share, governance rights, featured placement',
      SOVEREIGN: 'Lifetime revenue share, Hall of Fame, institutional partnerships',
    },
    reputationScore: row.reputation_score,
    streakDays,
    streakMultiplier,
    nextTier,
    nextTierRequirements: nextTier ? TIER_THRESHOLDS[nextTier] : null,
    achievements: achievements.results ?? [],
  });
});

loyalty.post('/:address/streak', async (c) => {
  const address = c.req.param('address');
  const today = new Date().toISOString().split('T')[0];

  const row = await c.env.DB
    .prepare('SELECT streak_days, last_active_date FROM analysts WHERE LOWER(address) = LOWER(?)')
    .bind(address)
    .first<{ streak_days: number; last_active_date: string | null }>();

  if (!row) return c.json({ error: 'Analyst not found' }, 404);

  const lastActive = row.last_active_date;
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  let newStreak = 1;
  if (lastActive === yesterday) {
    newStreak = row.streak_days + 1;
  } else if (lastActive === today) {
    newStreak = row.streak_days;
  }

  await c.env.DB
    .prepare('UPDATE analysts SET streak_days = ?, last_active_date = ? WHERE LOWER(address) = LOWER(?)')
    .bind(newStreak, today, address)
    .run();

  return c.json({ streakDays: newStreak, multiplier: newStreak >= 100 ? 5.0 : newStreak >= 30 ? 2.5 : newStreak >= 7 ? 1.5 : 1.0 });
});

export { loyalty };
