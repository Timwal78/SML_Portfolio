-- Adds AWS Marketplace subscription-tier tracking to aws_marketplace_customers,
-- for the Section 8/HUD listing's tiered billing (Contractor/Professional/
-- Authority-Enterprise/Government — see docs/SECTION8_HUD_LISTING.md).
--
-- NOT applied automatically by any code in this repo — this is the first
-- migration file in this repo (aws_marketplace_customers itself has no
-- committed migration; it was created ad hoc). Run this manually against
-- the real Supabase project before AWS_MARKETPLACE_TIER_DIMENSIONS_JSON is
-- set, or src/server/aws/tiers.ts's checkAndRecordHousingUsage() will just
-- fail open (log an error, treat every call as within-cap) until it exists
-- — that's a deliberate fail-open, not a crash, but it also means tiers
-- silently don't enforce until this migration has actually been run.
--
-- Safe to run against the live, already-in-use table: all three columns are
-- nullable/defaulted additions, nothing existing is altered or dropped, and
-- the full-catalog listing (prod-lop2m2yjjcs76) never reads or writes these
-- columns — see aws/tiers.ts and isHousingProduct() in aws/marketplace.ts.

ALTER TABLE aws_marketplace_customers
  ADD COLUMN IF NOT EXISTS tier text,
  ADD COLUMN IF NOT EXISTS calls_this_period integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS period_start date;

COMMENT ON COLUMN aws_marketplace_customers.tier IS
  'Internal tier key (contractor / professional / authority_enterprise / government) resolved from the AWS GetEntitlements Dimension via AWS_MARKETPLACE_TIER_DIMENSIONS_JSON. NULL = no cap enforcement (unconditional bypass, same as the untiered full-catalog listing).';
COMMENT ON COLUMN aws_marketplace_customers.calls_this_period IS
  'x402-bypassed call count for the current billing period (see period_start). Only incremented for tiered (Section 8/HUD) customers.';
COMMENT ON COLUMN aws_marketplace_customers.period_start IS
  'First-of-month date (UTC) this calls_this_period count is for. A stored value from a prior month means the count resets to 0 before this call is counted.';
