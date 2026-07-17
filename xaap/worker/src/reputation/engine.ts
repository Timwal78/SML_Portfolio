import type { D1Database } from '@cloudflare/workers-types';
import type { Tier, BadgeId, BADGES } from '../types/index.js';
import { BADGES, TIER_REQUIREMENTS, STREAK_MULTIPLIERS } from '../types/index.js';

export async function recordReputationEvent(
  db: D1Database,
  auditorAddress: string,
  eventType: string,
  baseDelta: number,
  relatedId?: string,
  note?: string
): Promise<void> {
  const auditor = await db.prepare(
    'SELECT streak_days, tier FROM auditors WHERE address = ?'
  ).bind(auditorAddress).first<{ streak_days: number; tier: Tier }>();

  if (!auditor) return;

  // Apply streak multiplier
  const mult = STREAK_MULTIPLIERS.find(m => auditor.streak_days >= m.days)?.multiplier ?? 1.0;
  const finalDelta = baseDelta * mult;

  await db.batch([
    db.prepare(
      `INSERT INTO reputation_events (id, auditor_address, event_type, delta, multiplier, note, related_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(), auditorAddress, eventType, finalDelta, mult,
      note ?? null, relatedId ?? null
    ),
    db.prepare(
      `UPDATE auditors
       SET reputation_score = MIN(100, MAX(0, reputation_score + ?)),
           last_active = unixepoch()
       WHERE address = ?`
    ).bind(finalDelta, auditorAddress),
  ]);
}

export async function recordFindingValidated(
  db: D1Database,
  auditorAddress: string,
  findingId: string,
  severity: string
): Promise<void> {
  const delta = severity === 'CRITICAL' ? 20 : severity === 'HIGH' ? 10 : severity === 'MEDIUM' ? 5 : 2;

  await db.batch([
    db.prepare(
      `UPDATE auditors
       SET validated_findings = validated_findings + 1,
           accuracy_rate = CAST(validated_findings + 1 AS REAL) / CAST(NULLIF(total_findings, 0) AS REAL)
       WHERE address = ?`
    ).bind(auditorAddress),
    db.prepare(
      `UPDATE findings SET status = 'VALIDATED', validated_at = unixepoch() WHERE id = ?`
    ).bind(findingId),
  ]);

  await recordReputationEvent(db, auditorAddress, 'FINDING_VALIDATED', delta, findingId,
    `${severity} severity finding validated`);

  // Check for achievements
  const auditor = await db.prepare(
    'SELECT validated_findings FROM auditors WHERE address = ?'
  ).bind(auditorAddress).first<{ validated_findings: number }>();

  if ((auditor?.validated_findings ?? 0) === 1) {
    await awardAchievement(db, auditorAddress, 'FIRST_BLOOD');
  }
  if ((auditor?.validated_findings ?? 0) % 10 === 0 && (auditor?.validated_findings ?? 0) > 0) {
    await awardAchievement(db, auditorAddress, 'PROPHET');
  }

  await recalcTier(db, auditorAddress);
}

export async function recordFindingInvalidated(
  db: D1Database,
  auditorAddress: string,
  findingId: string
): Promise<void> {
  await db.batch([
    db.prepare(
      `UPDATE auditors
       SET invalidated_findings = invalidated_findings + 1,
           accuracy_rate = CAST(validated_findings AS REAL) / CAST(NULLIF(total_findings, 0) AS REAL)
       WHERE address = ?`
    ).bind(auditorAddress),
    db.prepare(
      `UPDATE findings SET status = 'INVALIDATED', validated_at = unixepoch() WHERE id = ?`
    ).bind(findingId),
  ]);

  await recordReputationEvent(db, auditorAddress, 'FINDING_INVALIDATED', -5, findingId,
    'Finding invalidated by jury');
  await recalcTier(db, auditorAddress);
}

export async function updateStreak(db: D1Database, auditorAddress: string): Promise<void> {
  const auditor = await db.prepare(
    'SELECT last_active, streak_days FROM auditors WHERE address = ?'
  ).bind(auditorAddress).first<{ last_active: number; streak_days: number }>();
  if (!auditor) return;

  const now = Math.floor(Date.now() / 1000);
  const daysSinceActive = (now - auditor.last_active) / 86400;

  let newStreak: number;
  if (daysSinceActive <= 1.1) {
    newStreak = auditor.streak_days + 1;
    const prevMult = STREAK_MULTIPLIERS.find(m => auditor.streak_days >= m.days)?.multiplier ?? 1.0;
    const newMult = STREAK_MULTIPLIERS.find(m => newStreak >= m.days)?.multiplier ?? 1.0;
    if (newMult > prevMult) {
      await recordReputationEvent(db, auditorAddress, 'STREAK_BONUS', 5, undefined,
        `Streak milestone: ${newStreak} days (${newMult}x multiplier)`);
    }
  } else if (daysSinceActive > 2) {
    newStreak = Math.max(0, auditor.streak_days - Math.floor(daysSinceActive - 1));
  } else {
    newStreak = auditor.streak_days;
  }

  await db.prepare(
    'UPDATE auditors SET streak_days = ?, last_active = ? WHERE address = ?'
  ).bind(newStreak, now, auditorAddress).run();
}

export async function recalcTier(db: D1Database, auditorAddress: string): Promise<void> {
  const auditor = await db.prepare(
    'SELECT total_findings, accuracy_rate, reputation_score FROM auditors WHERE address = ?'
  ).bind(auditorAddress).first<{ total_findings: number; accuracy_rate: number; reputation_score: number }>();
  if (!auditor) return;

  const tierOrder: Tier[] = ['CITIZEN', 'DETECTIVE', 'INVESTIGATOR', 'AUDITOR', 'GRAND_INQUISITOR'];
  let newTier: Tier = 'CITIZEN';

  for (const tier of tierOrder) {
    const req = TIER_REQUIREMENTS[tier];
    if (auditor.total_findings >= req.min_findings && auditor.accuracy_rate >= req.min_accuracy) {
      newTier = tier;
    } else {
      break;
    }
  }

  await db.prepare('UPDATE auditors SET tier = ? WHERE address = ?').bind(newTier, auditorAddress).run();
}

export async function awardAchievement(
  db: D1Database,
  auditorAddress: string,
  badgeId: BadgeId
): Promise<boolean> {
  try {
    await db.prepare(
      `INSERT INTO achievements (id, auditor_address, badge_id) VALUES (?, ?, ?)`
    ).bind(crypto.randomUUID(), auditorAddress, badgeId).run();
    return true;
  } catch {
    // Already awarded (unique constraint)
    return false;
  }
}
