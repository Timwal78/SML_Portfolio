import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AuditLogger } from '../security/audit.js';

// AWS subscription-tier usage caps + overage for the Section 8/HUD listing.
// See docs/SECTION8_HUD_LISTING.md for the published tier table (Contractor
// $199/mo, Professional $449/mo, Authority/Enterprise $999/mo, Government
// custom). That doc's pricing table doesn't restate call-volume caps after
// the SDVOSB reposition — this maps 1:1 onto the original four-tier
// call-volume structure (Starter/Professional/Business/Enterprise ->
// 5,000/25,000/100,000/unlimited) in the same order, since the rename kept
// the tier count and relative ordering. If that assumption is wrong, fix
// the numbers below — nothing else in this file needs to change.
//
// ONLY ever applies to the Section 8/HUD listing (AWS_MARKETPLACE_HOUSING_PRODUCT_CODE).
// The existing full-catalog listing (prod-lop2m2yjjcs76) has no tiers and
// is never routed through any function in this file.
export const TIER_MONTHLY_CALL_CAP: Record<string, number> = {
  contractor: 5000,
  professional: 25000,
  authority_enterprise: 100000,
  government: Infinity, // custom/negotiated via AWS Private Offer — no self-imposed cap
};

/**
 * Maps AWS's real GetEntitlements Dimension string (chosen by the operator
 * when configuring the product's SaaS Contract dimensions in AWS Partner
 * Central — this codebase cannot know them in advance) to an internal tier
 * key via AWS_MARKETPLACE_TIER_DIMENSIONS_JSON. Returns null when the env
 * var is unset, malformed, or the dimension isn't mapped — callers must
 * treat null as "no cap enforcement", never as an error.
 */
export function resolveTierFromDimension(dimension: string | undefined | null): string | null {
  if (!dimension) return null;
  const raw = process.env['AWS_MARKETPLACE_TIER_DIMENSIONS_JSON']?.trim();
  if (!raw) return null;
  try {
    const map = JSON.parse(raw) as Record<string, string>;
    return map[dimension] ?? null;
  } catch (err) {
    AuditLogger.getInstance().error('aws_mp_tier_dimensions_json_invalid', { error: String(err) });
    return null;
  }
}

/** First-of-month date string (UTC) identifying the current billing period. */
export function currentPeriodStart(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Pure decision logic, no I/O — unit-testable without a database. Given a
 * tier's cap and what's stored for a customer, decides whether this call is
 * within cap and what the row should be updated to. A period rollover
 * (stored period_start != the current one) resets the count to 0 before
 * counting this call.
 */
export function computeUsageDecision(
  cap: number,
  storedCount: number,
  storedPeriodStart: string | null,
  nowPeriodStart: string,
): { withinCap: boolean; newCount: number; periodStart: string } {
  const rolledOver = storedPeriodStart !== nowPeriodStart;
  const currentCount = rolledOver ? 0 : storedCount;
  if (currentCount >= cap) {
    // Already at/over cap — don't increment further, this call is overage.
    return { withinCap: false, newCount: currentCount, periodStart: nowPeriodStart };
  }
  return { withinCap: true, newCount: currentCount + 1, periodStart: nowPeriodStart };
}

let supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient | null {
  if (supabase) return supabase;
  const url = process.env['SUPABASE_URL']?.trim();
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']?.trim();
  if (!url || !key) return null;
  supabase = createClient(url, key);
  return supabase;
}

/**
 * Checks and (if within cap) increments an AWS Marketplace housing
 * customer's monthly usage. Returns withinCap:true whenever cap enforcement
 * can't run for any reason — no tier resolved, DB unconfigured, the
 * tier/calls_this_period/period_start columns don't exist yet (migration
 * not applied), or a transient DB error. This fails OPEN deliberately: an
 * infra gap on our side must never block or misbill a customer who already
 * paid AWS for their subscription. It only ever narrows access (denying
 * bypass -> falling through to ordinary x402 payment for the overage),
 * never widens it beyond what productCoversResource already allows.
 */
export async function checkAndRecordHousingUsage(apiKey: string): Promise<{ withinCap: boolean }> {
  const db = getSupabase();
  if (!db) return { withinCap: true };
  try {
    const { data, error } = await db
      .from('aws_marketplace_customers')
      .select('tier, calls_this_period, period_start')
      .eq('api_key', apiKey)
      .maybeSingle();
    if (error) {
      // Most likely the migration in supabase/migrations/0001_aws_marketplace_tiers.sql
      // hasn't been applied yet — the tier/calls_this_period/period_start
      // columns don't exist. Log once loudly, fail open.
      AuditLogger.getInstance().error('aws_mp_usage_check_failed', { error: error.message });
      return { withinCap: true };
    }
    const tier = (data?.['tier'] as string | null) ?? null;
    if (!tier) return { withinCap: true };
    const cap = TIER_MONTHLY_CALL_CAP[tier];
    if (cap === undefined || cap === Infinity) return { withinCap: true };

    const nowPeriodStart = currentPeriodStart();
    const decision = computeUsageDecision(
      cap,
      (data?.['calls_this_period'] as number | null) ?? 0,
      (data?.['period_start'] as string | null) ?? null,
      nowPeriodStart,
    );

    if (decision.withinCap) {
      await db
        .from('aws_marketplace_customers')
        .update({ calls_this_period: decision.newCount, period_start: decision.periodStart })
        .eq('api_key', apiKey);
    }
    return { withinCap: decision.withinCap };
  } catch (err) {
    AuditLogger.getInstance().error('aws_mp_usage_check_exception', { error: String(err) });
    return { withinCap: true };
  }
}
