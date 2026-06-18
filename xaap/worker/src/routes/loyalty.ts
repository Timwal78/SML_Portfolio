import { Hono } from 'hono';
import type { Env, Tier, TIER_REQUIREMENTS, BADGES } from '../types/index.js';
import { TIER_REQUIREMENTS as TR, BADGES as B } from '../types/index.js';

export const loyaltyRouter = new Hono<{ Bindings: Env }>();

// GET /api/v1/loyalty/:address — tier + streaks + achievements
loyaltyRouter.get('/:address', async (c) => {
  const address = c.req.param('address').toLowerCase();
  const auditor = await c.env.DB.prepare(
    `SELECT address, tier, reputation_score, accuracy_rate, total_findings,
            validated_findings, streak_days, last_active, total_earned_usdc
     FROM auditors WHERE address = ?`
  ).bind(address).first<{
    tier: Tier; streak_days: number; total_findings: number;
    accuracy_rate: number; reputation_score: number;
    last_active: number;
  }>();

  if (!auditor) return c.json({ error: 'Auditor not found' }, 404);

  const achievements = await c.env.DB.prepare(
    `SELECT badge_id, earned_at FROM achievements WHERE auditor_address = ? ORDER BY earned_at DESC`
  ).bind(address).all();

  // Compute streak multiplier
  const streakMult = auditor.streak_days >= 100 ? 5.0
    : auditor.streak_days >= 30 ? 2.5
    : auditor.streak_days >= 7 ? 1.5
    : 1.0;

  // Next tier requirements
  const tierOrder: Tier[] = ['CITIZEN', 'DETECTIVE', 'INVESTIGATOR', 'AUDITOR', 'GRAND_INQUISITOR'];
  const currentIdx = tierOrder.indexOf(auditor.tier);
  const nextTier = tierOrder[currentIdx + 1];
  const nextReqs = nextTier ? TR[nextTier] : null;

  return c.json({
    ...auditor,
    streak_multiplier: streakMult,
    achievements: achievements.results.map(a => ({
      ...a,
      ...B[a.badge_id as keyof typeof B],
    })),
    next_tier: nextTier ?? null,
    next_tier_requirements: nextReqs,
    progress: nextReqs ? {
      findings: `${auditor.total_findings}/${nextReqs.min_findings}`,
      accuracy: `${(auditor.accuracy_rate * 100).toFixed(1)}%/${(nextReqs.min_accuracy * 100)}%`,
    } : null,
  });
});
