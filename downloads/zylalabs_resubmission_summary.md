# ZylaLabs resubmission pack — ScriptMasterLabs

## Fixes applied (per Tomas H email 2026-07-20)
1. **Names/descriptions** — functional only; no external provider/source brand references.
2. **Parameters** — every API has an explicit parameter list (name, type, required, description).

- APIs in pack: **47**
- Empty parameter lists: **0**
- Residual brand hits: **0**

## API index

1. **Federal Contract Opportunities Feed** — params: naics, agency, state, keyword, limit
   - Real-time feed of federal contract opportunities. Search by NAICS code, agency, state, or keyword. Includes solicitation type, response deadline, award value, and contracting offic…
   - endpoint hint: `/v1/federal-contract-opportunities-feed`

2. **Federal Award History Tracker** — params: recipient, agency, from_date, to_date, limit
   - Historical federal contract award records. Track awarded contracts by recipient, agency, or date range. Includes award amount, recipient details, and contract performance data.
   - endpoint hint: `/v1/federal-award-history-tracker`

3. **Set-Aside Contract Feed for Small Business** — params: category, naics, state, limit
   - Federal set-aside contract opportunities filtered by socio-economic category (SDVOSB, WOSB, HUBZone, 8(a)). Includes eligibility requirements and response deadlines.
   - endpoint hint: `/v1/set-aside-contract-feed-for-small-business`

4. **Entity Registration Verification** — params: uei, cage, entity_name
   - Verify business entity registration status, exclusion/debarment flags, set-aside eligibility, and NAICS codes. Check if a contractor is registered and in good standing.
   - endpoint hint: `/v1/entity-registration-verification`

5. **Federal Spending by Agency** — params: agency, fiscal_year, state, limit
   - Federal spending breakdown by agency, category, and geographic distribution. Track obligation and outlay amounts across fiscal years.
   - endpoint hint: `/v1/federal-spending-by-agency`

6. **Excluded Parties Check** — params: entity_name
   - Check if an entity is on the federal excluded/debarred parties list. Cross-reference recipient records with award history for compliance screening.
   - endpoint hint: `/v1/excluded-parties-check`

7. **Annual Financial Report Filings** — params: ticker, limit
   - Annual financial report filings for any public company. Retrieve filing dates, accession numbers, and direct links to full reports. Includes balance sheet, income statement, and ca…
   - endpoint hint: `/v1/annual-financial-report-filings`

8. **Quarterly Financial Report Filings** — params: ticker, limit
   - Quarterly financial report filings for any public company. Retrieve filing dates, accession numbers, and links to full quarterly reports.
   - endpoint hint: `/v1/quarterly-financial-report-filings`

9. **Material Event Filings Feed** — params: ticker
   - Real-time material event filings for any public company. Includes event type, filing date, and summary for event-driven trading and monitoring.
   - endpoint hint: `/v1/material-event-filings-feed`

10. **Insider Trading Activity Tracker** — params: ticker
   - Insider trading transaction filings for any public company. Track executive buys, sells, and option exercises with transaction dates, share counts, and prices.
   - endpoint hint: `/v1/insider-trading-activity-tracker`

11. **Institutional Holdings Filings** — params: cik, name
   - Quarterly institutional investment manager holdings filings. Retrieve position-level data for funds and institutions with filing URLs to full holdings tables.
   - endpoint hint: `/v1/institutional-holdings-filings`

12. **Activist Investor Filings** — params: ticker, limit
   - Activist investor 5%+ stake filings for any ticker. Track filer name, form type, filing date, and stake percentage for activist position monitoring.
   - endpoint hint: `/v1/activist-investor-filings`

13. **Warning Letters Feed** — params: company, product, limit
   - Regulatory warning letters issued to companies. Includes company name, subject, issued date, issuing office, and product type. Filter by company or product.
   - endpoint hint: `/v1/warning-letters-feed`

14. **Drug Recall Alerts** — params: drug, limit
   - Drug and medical device recall enforcement reports. Track recall events by drug name, recall class, and date. Includes recalling firm and recall reason.
   - endpoint hint: `/v1/drug-recall-alerts`

15. **Adverse Event Reports** — params: drug, limit
   - Adverse event reports for drugs and medical products. Includes reaction type, severity, patient outcomes, and report dates. Filter by drug name.
   - endpoint hint: `/v1/adverse-event-reports`

16. **Environmental Violation Records** — params: facility, state, naics, limit
   - Facility environmental enforcement and violation records. Includes inspection counts, penalty amounts, and compliance status. Filter by facility, state, or industry code.
   - endpoint hint: `/v1/environmental-violation-records`

17. **Workplace Safety Inspection Records** — params: establishment, state, naics, limit
   - Workplace safety inspection records with activity type, citations, penalties, and open/closed status. Filter by employer name, state, or industry code.
   - endpoint hint: `/v1/workplace-safety-inspection-records`

18. **Campaign Finance Data** — params: name, committee, cycle
   - Campaign finance data with receipts, disbursements, party affiliation, office sought, and election cycle. Filter by candidate, committee, or cycle.
   - endpoint hint: `/v1/campaign-finance-data`

19. **Legislation Search** — params: query, congress, limit
   - Search legislation by keyword, session number, and bill status. Includes sponsor, cosponsors, bill text, and legislative action history.
   - endpoint hint: `/v1/legislation-search`

20. **Lobbying Disclosures Feed** — params: client, registrant, issue, limit
   - Lobbying registration and disclosure filings. Includes client, registrant, issue areas, and reported amounts. Filter by client, registrant, or issue code.
   - endpoint hint: `/v1/lobbying-disclosures-feed`

21. **Economic Indicators Dashboard** — params: series_id, category, limit
   - Economic indicators including GDP, inflation, unemployment, interest rates, and consumer sentiment. Filter by indicator series ID or category.
   - endpoint hint: `/v1/economic-indicators-dashboard`

22. **Perpetual Futures Funding Rates** — params: coin, exchange, limit
   - Aggregated funding rates across major perpetual futures exchanges. Track funding by coin, exchange, or time range. Includes prediction, basis, and spread data.
   - endpoint hint: `/v1/perpetual-futures-funding-rates`

23. **Market Regime Indicator** — params: asset, timeframe
   - Market regime classification (risk-on, risk-off, transition) based on liquidity, volatility, and sentiment factors. Includes regime score and directional bias.
   - endpoint hint: `/v1/market-regime-indicator`

24. **DeFi Yield Rates Aggregator** — params: chain, min_apy, min_tvl, project, top_n
   - DeFi yield rates across 15000+ liquidity pools. Filter by minimum APY, minimum TVL, chain, or protocol. Includes risk scores and TVL data.
   - endpoint hint: `/v1/defi-yield-rates-aggregator`

25. **DeFi TVL Rankings** — params: chain, category, top_n
   - Total Value Locked rankings across 7800+ DeFi protocols. Filter by chain, category, or top N. Includes 24h/7d/1m changes and market cap data.
   - endpoint hint: `/v1/defi-tvl-rankings`

26. **Airdrop Eligibility Scanner** — params: wallet, chain
   - Check wallet address for eligible airdrops across multiple blockchains. Returns claimable amounts, deadlines, and claim links.
   - endpoint hint: `/v1/airdrop-eligibility-scanner`

27. **Wallet Analysis Tool** — params: address, chain
   - On-chain wallet analysis including net worth, holdings, risk score, DeFi positions, and behavioral flags. Supports multiple blockchains.
   - endpoint hint: `/v1/wallet-analysis-tool`

28. **Gas Price Tracker** — params: chain, unit
   - Real-time gas prices and transaction cost estimates across multiple blockchains. Includes priority fee recommendations and historical trends.
   - endpoint hint: `/v1/gas-price-tracker`

29. **Trending Tokens Scanner** — params: chain, limit
   - Trending tokens by trading volume, price momentum, and top gainers. Filter by chain and limit results. Includes momentum scores.
   - endpoint hint: `/v1/trending-tokens-scanner`

30. **Smart Money Flow Tracker** — params: token, limit
   - Smart money wallet activity tracker. Monitor whale buys, sells, and token flows. Filter by token or limit results for copy trading signals.
   - endpoint hint: `/v1/smart-money-flow-tracker`

31. **New Token Detection** — params: chain, limit
   - Recently launched token detection across major DEXes. Includes liquidity, volume, holder count, and age. Filter by chain.
   - endpoint hint: `/v1/new-token-detection`

32. **Liquidation Risk Monitor** — params: address, chain
   - Liquidation risk assessment for leveraged positions. Calculate liquidation prices, health factors, and risk levels for any wallet.
   - endpoint hint: `/v1/liquidation-risk-monitor`

33. **Token Risk Audit Scanner** — params: chain_id, token_address
   - Token risk audit including honeypot detection, rugpull risk, buy/sell tax analysis, ownership verification, and liquidity lock status.
   - endpoint hint: `/v1/token-risk-audit-scanner`

34. **Fact Check Oracle** — params: claim, domain
   - Grounding oracle that fact-checks claims against live government and regulatory data sources. Returns verdict, confidence score, and supporting sources.
   - endpoint hint: `/v1/fact-check-oracle`

35. **Entity Compliance Check** — params: uei, cage
   - Business entity compliance check including registration status, exclusion flags, set-aside eligibility, and industry code verification.
   - endpoint hint: `/v1/entity-compliance-check`

36. **Macro Regime Analysis** — params: query, assets, timeframe
   - Macro market regime analysis with liquidity outlook, forward view, and trade thesis. Classifies market as risk-on, risk-off, or transition. Includes asset recommendations and risk/…
   - endpoint hint: `/v1/macro-regime-analysis`

37. **Compliance Anomaly Reporter** — params: bank_id, agent_id, trigger, detail, severity
   - Submit compliance anomalies for swarm-based scoring. Detects AML flags, financial crime indicators, and risk patterns. Returns severity score.
   - endpoint hint: `/v1/compliance-anomaly-reporter`

38. **Bank Compliance Audit** — params: bank_id
   - Full compliance audit cycle for financial institutions. Includes regulatory audit scoring, risk assessment, and compliance status dashboard.
   - endpoint hint: `/v1/bank-compliance-audit`

39. **Regulatory Compliance Query** — params: bank_id
   - Real-time regulatory compliance dashboard for financial institutions. Query compliance status, open issues, and regulatory findings.
   - endpoint hint: `/v1/regulatory-compliance-query`

40. **Rugpull Detector** — params: chain_id, token_address
   - Real-time rugpull risk detection for any token. Monitors liquidity removal, developer wallet activity, and contract manipulation patterns. Returns risk score and warning flags.
   - endpoint hint: `/v1/rugpull-detector`

41. **API Documentation Catalog** — params: category, q, limit
   - Full API catalog with pricing, schemas, and data sources for all available endpoints. Includes example requests and response formats.
   - endpoint hint: `/v1/api-documentation-catalog`

42. **Capabilities Introspection Endpoint** — params: module, include_examples, limit
   - Free introspection endpoint returning the complete offering catalog with names, descriptions, prices, SLA minutes, and subscription options.
   - endpoint hint: `/v1/capabilities-introspection-endpoint`

43. **DeFi Yield API Catalog** — params: category, q, limit
   - Catalog page for DeFi yield rate endpoints. Lists all available yield farming and APY aggregation endpoints with parameters and examples.
   - endpoint hint: `/v1/defi-yield-api-catalog`

44. **Token Risk Detection API Catalog** — params: category, q, limit
   - Catalog page for honeypot and rugpull detection endpoints. Lists all available token risk scanning endpoints with parameters and examples.
   - endpoint hint: `/v1/token-risk-detection-api-catalog`

45. **Perpetual Futures Funding API Catalog** — params: category, q, limit
   - Catalog page for funding rate and perpetual futures data endpoints. Lists all available funding rate endpoints with parameters and examples.
   - endpoint hint: `/v1/perpetual-futures-funding-api-catalog`

46. **Trending Tokens API Catalog** — params: category, q, limit
   - Catalog page for trending token scanner endpoints. Lists all available trending detection endpoints with parameters and examples.
   - endpoint hint: `/v1/trending-tokens-api-catalog`

47. **Wallet Analysis API Catalog** — params: category, q, limit
   - Catalog page for wallet analysis and wallet analyzer endpoints. Lists all available wallet intelligence endpoints with parameters and examples.
   - endpoint hint: `/v1/wallet-analysis-api-catalog`

## Reply to Zyla (copy/paste)

Subject: Re: API submission fixes — names/descriptions + parameters

Hi Tomas,

Thanks for the review notes — both items are fixed:

1) Names and descriptions now describe functionality only. They no longer reference external/original providers.
2) Every submitted API now includes explicit parameters (name, type, required, description) appropriate to each endpoint.

We prepared an updated pack of 47 APIs reflecting these changes and are ready for re-review.
Please let us know if you need the pack attached in a specific Zyla template/format or re-entered in the publisher UI.

Best regards,
Script Master Labs
hello@scriptmasterlabs.com

