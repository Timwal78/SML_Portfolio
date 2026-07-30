# Section 8 / HUD / PHA Listing — Positioning & Pricing

Status date: 2026-07-29. Same convention as `AGENT_ECONOMY_OS_PRICING.md` —
separates what is **live and charging today** from what is **proposed and
not yet wired**. Do not present the proposed tiers as purchasable anywhere
until the corresponding AWS Marketplace product/dimensions actually exist.

## The moat (lead with this, don't bury it)

This is not "housing data for landlords." It's:

**SDVOSB-built Section 8 / Public Housing Authority intelligence, with live
SAM.gov set-aside opportunity search built into the same product** — a
combination most housing-data vendors can't copy because they aren't a
registered SDVOSB and don't already operate live federal procurement tools.

- Real, registered SDVOSB: UEI `G24VZA4RLMK3`, CAGE `21U51` (already
  returned in every `pha_opportunities` response as `operator_sdvosb`, and
  in `federal_sam_entity`/`federal_sam_opportunities`).
- Real, live SAM.gov integration already in production (`federal.ts`),
  reused as-is by `pha_opportunities` — not a separate, weaker federal
  integration built just for this listing.
- Set-aside filtering (`set_aside` param, SAM's `typeOfSetAside` codes —
  e.g. `SDVOSBC`) works today on `pha_opportunities`, so an agent or
  contractor can find SDVOSB/VOSB/8(a)-eligible housing-authority work in
  the same call that finds the housing data itself.

## LIVE TODAY

### Nationwide tools (real HUD User API + HUD Open Data + real SAM.gov, any US location)

| Tool | Price (USDC) | What it does |
|------|--------------|--------------|
| `section8_geo_lookup` | $0.004 | HUD entity IDs for states/counties/metros — the lookup you need before calling the two below |
| `section8_fmr` | $0.006 | Fair Market Rents (Section 8 payment-standard baseline), any county/metro/state |
| `section8_income_limits` | $0.006 | HUD income limits (30/50/80% AMI eligibility), any county/metro/state |
| `pha_opportunities` | $0.012 | Real SAM.gov opportunities filtered for housing authority / Section 8 / HCV work, with NAICS + set-aside filtering |
| `pha_search` | $0.008 | Nationwide PHA search by name/city/state/ZIP — live HUD Open Data ArcGIS FeatureServer (`services.arcgis.com/VTyQ9soqVukalItT/.../Public_Housing_Authorities/FeatureServer/0`), ~3,300+ agencies, no auth |

`section8_geo_lookup`/`section8_fmr`/`section8_income_limits` are gated on
`HUD_USER_TOKEN` (free registration); `pha_opportunities` needs
`SAM_API_KEY`; `pha_search` needs neither (public FeatureServer). All fail
with a clear "not configured"/upstream error rather than ever fabricating a
number, per this repo's `SOVEREIGN_DATA_POLICY.md`.

`pha_search`'s FeatureServer URL was independently verified live (name,
field list, and record count cross-checked against HUD's own published
~3,300-agency figure) before being wired in — not guessed. If it ever 404s
in production, that means HUD moved the dataset, not that the integration
was ever speculative.

### Curated tools (Lenoir County, NC / Kinston only — not nationwide)

| Tool | Price (USDC) | Coverage |
|------|--------------|----------|
| `pha_lookup` | $0.001 | Curated single-PHA directory (Kinston Housing Authority) |
| `hcv_fmr` | $0.001 | Curated FMR for Lenoir County only — returns an explicit `zip_not_in_curated_seed` error for anywhere else, never fabricated numbers |
| `housing_landlord_checklist` | $0.001 | HCV/Section 8 landlord onboarding + HQS checklist (Lenoir County context) |
| `hud_vash_contacts` | $0.001 | HUD-VASH veteran voucher contacts (Eastern NC) |

These four are personal/regional tools (built for the operator's own rental
property) and are not part of the nationwide pitch above.

### Free
`sml_discover`, `sml_status` (catalog + health, no wallet needed).

## PROPOSED — CODE EXISTS, DORMANT UNTIL CONFIGURED (do not sell until the AWS product exists)

### AWS Marketplace subscription tiers (SDVOSB/federal-aware)

| Tier | Monthly | Annual | Assumed call cap/mo* | Who it's for |
|------|---------|--------|-----------------------|---------------|
| Contractor | $199 | $1,990 | 5,000 | Small–mid SDVOSB/VOSB contractors, regional housing vendors |
| Professional | $449 | $4,490 | 25,000 | Multi-state operators, mid-size contractors working with PHAs |
| Authority / Enterprise | $999 | $9,990 | 100,000 | Large property groups, bigger contractors, some PHAs |
| Government / Private Offer | Custom | Custom | Unlimited | Federal agencies, large primes, PHAs buying through AWS |

\* The SDVOSB reposition renamed/repriced the tiers without restating call
volumes. `src/server/aws/tiers.ts`'s `TIER_MONTHLY_CALL_CAP` assumes these
map 1:1 onto the original four-tier structure in the same order — fix that
constant if this assumption is wrong.

Rules (enforced by code, see below):
- All paid tiers include the full Section 8 + PHA toolset (both nationwide
  and curated) plus the set-aside-filtered opportunity tools — tiers don't
  gate *which* tools, only *how many calls/month* are free.
- Overage beyond a tier's monthly call cap bills at the public x402 rate
  card above — enforced by simply not granting the bypass once the cap is
  hit, so the overage call falls through to ordinary payment automatically.
- Use AWS Marketplace **Private Offers** for government and large-prime
  deals — the SDVOSB status is a real, usable lever there.
- Consider a discount/special terms for other SDVOSB/VOSB firms (ecosystem
  goodwill, not required to launch).
- Free 14-day trial on Contractor and Professional (an AWS Partner Central
  setting, not something this repo's code needs to implement).

**What's actually built (`src/server/aws/tiers.ts`, wired into `index.ts`'s
`requirePayment`):** tier-cap tracking and overage fallthrough, gated
entirely on `AWS_MARKETPLACE_HOUSING_PRODUCT_CODE` (unset by default). The
full-catalog listing is never routed through this — `isHousingProduct()` in
`aws/marketplace.ts` is the one guard that keeps that guarantee everywhere.
`resolveAwsMarketplaceCustomer()` best-effort resolves a subscriber's tier
via a real per-customer `GetEntitlements` call and
`AWS_MARKETPLACE_TIER_DIMENSIONS_JSON` (maps AWS's operator-chosen dimension
ID to the internal tier key — this repo can't know that ID until you create
the product's dimensions in Partner Central).

**Still needed before any of this actually enforces anything:**
1. Create the second AWS product + its 4 SaaS Contract dimensions in AWS
   Partner Central (operator action, not code).
2. Set `AWS_MARKETPLACE_HOUSING_PRODUCT_CODE` and
   `AWS_MARKETPLACE_TIER_DIMENSIONS_JSON` on Render.
3. Run `supabase/migrations/0001_aws_marketplace_tiers.sql` against the real
   Supabase project — **not applied by any agent**, this repo only ships the
   SQL. Until it's run, `checkAndRecordHousingUsage()` fails open (logs an
   error, treats every call as within-cap) rather than crashing — so tiers
   silently don't enforce, they don't break anything either.
4. The exact `GetEntitlementsCommand` `Filter`/`Dimension` shape used in
   `resolveAndStoreHousingTier()` is the documented AWS API shape but has
   not been exercised against a live AWS account — verify once a real
   housing subscriber goes through checkout.

## Marketplace listing copy (ready to paste once the product exists)

**Title:** ScriptMasterLabs Section 8 & PHA Intelligence — SDVOSB-Built (x402/AWS)

**Short description:**
> SDVOSB-operated Section 8 / Public Housing Authority data with live
> SAM.gov set-aside opportunity search built in. Fair Market Rents, income
> limits, and housing-authority contract opportunities — for agents,
> landlords, property managers, and SDVOSB/VOSB housing contractors.

**Long description:**
> Built and operated by a verified Service-Disabled Veteran-Owned Small
> Business (SDVOSB, UEI G24VZA4RLMK3). Combines nationwide HUD Fair Market
> Rent and income-limit data with a live SAM.gov feed filtered for housing
> authority, Section 8, and Housing Choice Voucher work — including
> SDVOSB/VOSB/8(a) set-aside filtering, so contractors can find eligible
> opportunities in the same product that gives them the underlying housing
> data. Available to autonomous AI agents via x402 micropayments (as low as
> $0.004/call, no API key, no monthly minimum) or to enterprises via AWS
> Marketplace subscription billing.

## Positioning notes

- Every piece of Marketplace copy should mention SDVOSB status by name —
  it's the actual differentiator versus generic housing-data vendors, not
  an afterthought.
- Don't lead with "housing data for landlords" — lead with the
  SDVOSB + live-SAM.gov combination first, housing data second.
- Same rule as `AGENT_ECONOMY_OS_PRICING.md`: never present a proposed tier
  as purchasable until it's actually wired. Update this doc in the same
  commit as whatever builds it.
