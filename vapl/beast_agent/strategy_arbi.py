"""Beast Alpha Mesh Arbitrageur — the swarm's profit engine.

Runs AFTER all other Beast agents have listed their signals.
Browses the marketplace, buys the top signals from peer agents,
combines them into a higher-confidence composite thesis,
and relists at the same price — earning 90% of each downstream read.

This is the agent that closes the revenue loop:
  Peer agents earn RLUSD → Arbi pays them → Arbi earns from composite reads.
"""
from __future__ import annotations
import logging
import os
import time
import requests
import core

log = logging.getLogger("beast_vapl.arbi")

NAME       = "ARBI"
MAX_BUYS   = 3     # max signals to buy per run
BUY_BUDGET = 0.10  # max RLUSD spend per run (3× 0.02 RLUSD + buffer)


def execute(soul: dict, vcs: list) -> tuple[dict, str | None]:
    wallet = os.environ.get("AGENT_XRPL_ADDRESS", "")

    # Browse marketplace for fresh signals from peer agents
    log.info("Browsing Alpha Mesh for peer signals...")
    listings = core.marketplace_browse(limit=30)
    if not listings:
        log.info("No marketplace listings — arbi has nothing to buy")
        return {}, None

    # Filter for high-confidence, recent listings (not our own)
    own_wallet_prefix = wallet[:12] if wallet else ""
    candidates = [
        l for l in listings
        if not (own_wallet_prefix and l.get("seller", "").startswith(own_wallet_prefix))
        and float(str(l.get("confidence", 0) or 0)) >= 40
    ]
    candidates.sort(key=lambda x: -float(str(x.get("confidence", 0) or 0)))
    targets = candidates[:MAX_BUYS]

    if not targets:
        log.info("No suitable listings to buy (all low confidence or own listings)")
        return {}, None

    log.info("Found %d candidates — buying top %d", len(candidates), len(targets))

    # Buy each signal
    bought: list[dict] = []
    for listing in targets:
        lid  = listing["listing_id"]
        sym  = listing["symbol"]
        conf = float(str(listing.get("confidence", 0) or 0))

        log.info("Buying listing %s (%s conf=%.1f)...", lid[:8], sym, conf)
        token = core.get_marketplace_token(wallet, lid)
        if not token:
            log.warning("Payment for %s failed — skipping", lid[:8])
            continue

        signal = core.marketplace_buy(token, wallet, lid)
        if signal:
            bought.append(signal)
            vcs.append(core.issue_interaction_vc(
                soul, soul["did"], "MarketplaceArbiPurchase",
                f"{core.SQUEEZEOS_BASE}/api/marketplace/read", "success",
            ))
            log.info("Bought: %s %s conf=%.1f", sym, signal.get("bias"), conf)
        else:
            log.warning("Buy failed for listing %s", lid[:8])

    if not bought:
        log.info("Bought 0 signals — nothing to composite")
        return {}, None

    # Synthesize composite signal
    composite = _synthesize(bought)
    if not composite:
        return {}, None

    bias        = composite["bias"]
    confidence  = composite["confidence"]
    symbol      = composite["symbol"]

    signal_id = f"vapl:arbi:{int(time.time())}"
    vcs.append(core.issue_accuracy_vc(
        soul, soul["did"], signal_id, bias, "pending", confidence / 100.0,
    ))

    # Build composite thesis with full attribution
    sources = " + ".join(
        f"{s.get('symbol','?')}:{s.get('bias','?')}({float(str(s.get('confidence',0) or 0)):.0f}%)"
        for s in bought
    )
    thesis = (
        f"Beast Swarm ARBI composite signal — {symbol} aggregate: "
        f"{bias} with {confidence:.0f}% composite confidence. "
        f"Synthesized from {len(bought)} peer agent signals: [{sources}]. "
        f"Alpha Mesh arbitrage: bought signals individually, combined into "
        f"higher-conviction composite. VAPL-attested multi-source aggregation."
    )

    listing_id = core.marketplace_list(
        wallet, symbol, bias, confidence, thesis,
        signal_type="TREND", ttl_hours=8,
    )
    if listing_id:
        vcs.append(core.issue_interaction_vc(
            soul, soul["did"], "CompositeMarketplaceListing",
            f"{core.SQUEEZEOS_BASE}/api/marketplace/list", "success",
        ))
        log.info(
            "Listed composite: %s %s conf=%.1f from %d sources",
            symbol, bias, confidence, len(bought),
        )

    return composite, listing_id


def _synthesize(signals: list[dict]) -> dict | None:
    """Majority-vote synthesis of multiple signals into a composite."""
    if not signals:
        return None

    # Bias voting
    votes: dict[str, float] = {}
    for s in signals:
        b    = (s.get("bias") or "NEUTRAL").upper()
        conf = float(str(s.get("confidence", 50) or 50))
        votes[b] = votes.get(b, 0) + conf  # weight by confidence

    consensus_bias = max(votes, key=lambda k: votes[k])

    # Weighted average confidence
    total_conf = sum(float(str(s.get("confidence", 0) or 0)) for s in signals)
    avg_conf   = total_conf / len(signals)

    # Boost confidence slightly for consensus (more sources = higher conviction)
    boost     = min(10.0, len(signals) * 2.5)
    final_conf = min(95.0, avg_conf + boost)

    # Pick most common symbol or "MULTI"
    sym_counts: dict[str, int] = {}
    for s in signals:
        sym = s.get("symbol", "MULTI")
        sym_counts[sym] = sym_counts.get(sym, 0) + 1
    top_sym = max(sym_counts, key=lambda k: sym_counts[k])
    symbol  = top_sym if sym_counts[top_sym] > 1 else "MULTI"

    log.info(
        "Composite: %s %s conf=%.1f (boost=+%.1f votes=%s)",
        symbol, consensus_bias, final_conf, boost, votes,
    )
    return {"bias": consensus_bias, "confidence": final_conf, "symbol": symbol}
