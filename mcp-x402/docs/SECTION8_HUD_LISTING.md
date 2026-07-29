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

### Nationwide tools (real HUD User API + real SAM.gov, any US location)

| Tool | Price (USDC) | What it does |
|------|--------------|--------------|
| `section8_geo_lookup` | $0.004 | HUD entity IDs for states/counties/metros — the lookup you need before calling the two below |
| `section8_fmr` | $0.006 | Fair Market Rents (Section 8 payment-standard baseline), any county/metro/state |
| `section8_income_limits` | $0.006 | HUD income limits (30/50/80% AMI eligibility), any county/metro/state |
| `pha_opportunities` | $0.012 | Real SAM.gov opportunities filtered for housing authority / Section 8 / HCV work, with NAICS + set-aside filtering |

Gated on `HUD_USER_TOKEN` (free registration) and `SAM_API_KEY` — both fail
with a clear "not configured" error rather than ever fabricating a number,
per this repo's `SOVEREIGN_DATA_POLICY.md`.

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

## PROPOSED — NOT YET WIRED (do not sell until built)

### `pha_search` — nationwide PHA directory search by city/state/ZIP

On the rate card at $0.008 but **has no code and no verified data source**.
The only PHA data in this codebase is the single-entry Kinston seed above —
not a search. Needs either a confirmed real HUD PHA contact dataset/API
(this session's network access is blocked to both `huduser.gov` and
`arcgis.com`, so no URL has been verified — do not guess one and ship it),
or an explicit decision to launch with a small manually-curated PHA list
that's honestly scoped in the listing copy rather than claimed as full
nationwide coverage.

### AWS Marketplace subscription tiers (SDVOSB/federal-aware)

No AWS product, dimensions, or Stripe-equivalent billing exist for these
yet — this table is the target once the listing is created in AWS Partner
Central:

| Tier | Monthly | Annual | Who it's for |
|------|---------|--------|---------------|
| Contractor | $199 | $1,990 | Small–mid SDVOSB/VOSB contractors, regional housing vendors |
| Professional | $449 | $4,490 | Multi-state operators, mid-size contractors working with PHAs |
| Authority / Enterprise | $999 | $9,990 | Large property groups, bigger contractors, some PHAs |
| Government / Private Offer | Custom | Custom | Federal agencies, large primes, PHAs buying through AWS |

Rules for when these get built:
- All paid tiers include the full Section 8 + PHA toolset (both nationwide
  and curated) plus the set-aside-filtered opportunity tools.
- Overage beyond a tier's contracted call volume bills at the public x402
  rate card above.
- Use AWS Marketplace **Private Offers** for government and large-prime
  deals — the SDVOSB status is a real, usable lever there.
- Consider a discount/special terms for other SDVOSB/VOSB firms (ecosystem
  goodwill, not required to launch).
- Free 14-day trial on Contractor and Professional.

Implementing this for real needs, at minimum: a second AWS product code
(`AWS_MARKETPLACE_HOUSING_PRODUCT_CODE`, already wired as a no-op env var —
see `aws/marketplace.ts`'s `PRODUCT_TOOLSETS`), a tier field + monthly
call-count tracking (does not exist anywhere in this codebase today — the
current AWS bypass is all-or-nothing with no usage cap), and AWS Partner
Central configuration this repo can't do on its own.

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
