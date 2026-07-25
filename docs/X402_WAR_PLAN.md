# X402 WAR PLAN — ScriptMaster Labs
**Status:** ACTIVE  
**Date:** 2026-07-25  
**Doctrine:** Volume > vanity pricing. Match category leaders on UX, undercut on price, own niches they ignore.

## Enemy price floor (live)
| Player | Category | Floor |
|--------|----------|-------|
| Otto AI | Market/DeFi intel | **$0.001**/call |
| twit.sh | X/Twitter data | **$0.0025–$0.01** |
| agentutility | 796 agent tools | **$0.0025**+ |
| BlockRun | AI routing + audio + RPC | high volume micropay |
| 2s.io | 575+ everything API | micropay catalog |
| glim/cascade | live web/social | micropay |
| dTelecom | WebRTC/STT/TTS | credits from $0.10 |

## Our old problem
SML federal/trading endpoints were priced **$0.02–$0.35** while leaders sit at **$0.001–$0.01**.  
Agents optimize for cost. We were invisible on price.

## Immediate pricing doctrine (SHIPPED in code)
| Tier | New target | Examples |
|------|------------|----------|
| Commodity / high-freq | **$0.001–$0.003** | crypto price, FX, gas, screens, simple lookups |
| Standard data | **$0.005–$0.01** | FTD, options flow, grants, FDA, FRED, congress |
| Premium signal | **$0.025–$0.05** | Cascade Accumulator, Triple Lock, heavy SEC bundles |
| Enterprise compliance | **$0.25–$0.50** | Leviathan bank audit (still cut from $2.50–$5.00) |

**Rule:** advertised price == charged price. Never bait-and-switch.

## Copy / counter (legal: category clones, our data, our brand)
We do **not** steal trademarks, scrape paid backends, or pirate their code.  
We **do** clone the *product shape* agents already pay for.

### Wave 1 — ship this week (undercut + habit)
1. **Agent snack endpoints @ $0.001**
   - `crypto_token_price`, `crypto_trending`, `fx_exchange_rate`, gas/base fee
   - Free: `sml_discover`, health, 1 free preview/day per wallet (optional)
2. **Trading intel pack @ $0.005**
   - FTD threshold, FTD latest, options flow, squeeze preview
   - Market as: “cheaper Otto for equities FTD/RegSHO”
3. **Gov wedge stay unique @ $0.002–$0.01**
   - Grants, SAM, sanctions screen, trade leads — leaders barely touch this
   - Pitch: SDVOSB + live federal primary sources
4. **Cascade @ $0.05** (was $0.25)
   - Still premium vs snacks; 5× cheaper than old; chart Pine drives human funnel

### Wave 2 — category clones (build if not live)
| Clone target | Our version | Price |
|--------------|-------------|-------|
| twit.sh social | `sml_x_brief` (via existing X tooling / licensed data) | $0.002 |
| glim web fetch | `sml_web_fetch` + crawl toll | $0.001–$0.003 |
| agentutility skill packs | Bundle existing MCP tools as named packs | $0.0025/pack call |
| BlockRun TTS/audio | Only if we have real provider cost edge | cost+10% |
| 2s everything directory | Improve `sml_discover` + bazaar schema for x402scan | free discover |

### Wave 3 — distribution (this is the real war)
Price cuts mean nothing if x402scan / agents never hit us.
1. Register **every** paid URL on https://www.x402scan.com/resources/register
2. Valid `/.well-known/x402` + OpenAPI amounts matching live charges
3. ACP wedges stay **$0.001 gas** / **$0.003 RWA** (undercut)
4. Daily bot: hit own endpoints with tiny pays so recipient pages show activity
5. X posts: “$0.001 USDC — no key — Base” with one killer demo

## Kill list (what NOT to do)
- Don’t race to $0 on LLM-heavy paths that lose money after provider cost
- Don’t fake volume / fake data (sovereign data rule)
- Don’t clone brand names (BlockRun, twit.sh, Otto, etc.)
- Don’t wait for perfect product — ship thin vertical that agents recall

## Success metrics (7 days)
- x402scan recipient page for SML payTo shows rising tx_count
- ≥1 tool with **$0.001** clear on OpenAPI + successful paid call
- Cascade paid calls >0 after price cut
- At least 3 resources registered/visible on x402scan

## PayTo / rails
- Base USDC payTo (mcp-x402): `0x4e14B249D9A4c9c9352D780eCEB508A8eB7a7700`
- Keep Coinbase CDP facilitator + sovereign X-PAYMENT-TX path

## One-liner for agents
> ScriptMaster Labs: live federal + trading data on x402. From **$0.001 USDC**. No API key. Base.
