#!/usr/bin/env python3
"""Live paper trading loop (spec non-negotiable #1: minimum 90 days paper
before any real capital). Pulls live data -> factors -> agents -> ensemble
-> risk gate -> Alpaca paper execution, once per invocation (schedule this
script daily — e.g. a Render cron job or background worker loop — rather
than looping in-process, so a crash doesn't silently stop future days).

v1 launch scope: only the 8 agents that run on plain OHLCV + VIX data are
wired (see config.yaml's `paper_trading.implemented_agents`). The other 12
agents need Polygon/Alpha Vantage/Binance/FINRA/SEC EDGAR credentials that
aren't configured yet — see docs/API_REFERENCE.md's implementation-status
table. Ensemble weighting is equal-weight across the 8 agents (bootstrap
scheme) until enough live signal history accumulates to compute the real
rolling-30-day-Sharpe meta-learning weights.

Data source: Tradier (real-time, requires TRADIER_ACCESS_TOKEN +
TRADIER_SANDBOX). Falls back to nothing else — if Tradier is unreachable
or misconfigured, the run fails loudly rather than silently degrading to
a lower-quality source.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import pandas as pd
import yaml
from dotenv import load_dotenv

from src.agents import (
    BollingerBouncer,
    FearGreedContrarian,
    MeanReversionSniper,
    MomentumHunter,
    SeasonalityExpert,
    TrendFollower,
    VolRegimeDetector,
    VolumeConfirmer,
)
from src.data.base_client import UpstreamUnavailableError
from src.data.tradier_client import TradierClient
from src.execution.alpaca_adapter import AlpacaExecutionAdapter
from src.execution.base_adapter import OrderRequest
from src.monitoring.audit_log import AuditLogger
from src.pipeline.factor_builder import build_factor_frame
from src.risk.risk_engine import RiskConfig, RiskEngine, TradeProposal

IMPLEMENTED_AGENTS = {
    "MomentumHunter": MomentumHunter,
    "MeanReversionSniper": MeanReversionSniper,
    "VolRegimeDetector": VolRegimeDetector,
    "SeasonalityExpert": SeasonalityExpert,
    "BollingerBouncer": BollingerBouncer,
    "VolumeConfirmer": VolumeConfirmer,
    "TrendFollower": TrendFollower,
    "FearGreedContrarian": FearGreedContrarian,
}


def load_config(config_path: Path) -> dict:
    with open(config_path) as f:
        return yaml.safe_load(f)


def run_symbol(
    symbol: str,
    data_client: TradierClient,
    vix_close: pd.Series,
    agents: dict,
    lookback_days: int,
    audit: AuditLogger,
) -> tuple[float, float]:
    """Returns (ensemble_signal, latest_close)."""
    start = (pd.Timestamp.today().normalize() - pd.Timedelta(days=lookback_days)).strftime("%Y-%m-%d")
    ohlcv = data_client.get_ohlcv(symbol, start=start)
    factor_frame = build_factor_frame(ohlcv, vix_close)

    signals = {}
    for name, agent in agents.items():
        signal_series = agent.generate_signal(factor_frame)
        agent.validate_output(signal_series)
        signals[name] = int(signal_series.iloc[-1])
        audit.log_signal(name, symbol, signals[name])

    ensemble_signal = sum(signals.values()) / len(signals)
    latest_close = float(ohlcv["close"].iloc[-1])
    return ensemble_signal, latest_close


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the NATS v2.0 paper trading loop")
    parser.add_argument("--dry-run", action="store_true", help="Compute signals without submitting orders")
    parser.add_argument("--config", default=str(Path(__file__).parent.parent / "config.yaml"))
    args = parser.parse_args()

    load_dotenv()

    if os.getenv("ALPACA_PAPER", "true").lower() != "true":
        raise RuntimeError(
            "ALPACA_PAPER must be 'true' — spec non-negotiable #1 requires 90 days "
            "of paper trading before any live capital is deployed. This script "
            "refuses to run against a live account."
        )

    config = load_config(Path(args.config))
    pt_cfg = config["paper_trading"]
    risk_cfg = RiskConfig(**config["risk"])
    trade_threshold = config["ensemble"]["trade_threshold"]

    audit = AuditLogger(Path(__file__).parent.parent / "logs" / "audit.jsonl")
    data_client = TradierClient(
        TRADIER_ACCESS_TOKEN=os.getenv("TRADIER_ACCESS_TOKEN", ""),
        TRADIER_SANDBOX=os.getenv("TRADIER_SANDBOX", "false"),
    )
    risk_engine = RiskEngine(risk_cfg)
    agents = {name: cls() for name, cls in IMPLEMENTED_AGENTS.items() if name in pt_cfg["implemented_agents"]}

    execution = None
    account_equity = None
    daily_pnl_pct = 0.0
    if not args.dry_run:
        api_key = os.getenv("ALPACA_API_KEY", "")
        secret_key = os.getenv("ALPACA_SECRET_KEY", "")
        execution = AlpacaExecutionAdapter(api_key, secret_key, paper=True)
        account = execution.get_account()
        account_equity = account["equity"]
        daily_pnl_pct = (account["equity"] - account["last_equity"]) / account["last_equity"]

    vix_start = (pd.Timestamp.today().normalize() - pd.Timedelta(days=pt_cfg["lookback_days"])).strftime("%Y-%m-%d")
    vix_close = data_client.get_ohlcv(pt_cfg["vix_symbol"], start=vix_start)["close"]

    for symbol in pt_cfg["universe"]:
        try:
            ensemble_signal, latest_close = run_symbol(
                symbol, data_client, vix_close, agents, pt_cfg["lookback_days"], audit
            )
        except UpstreamUnavailableError as exc:
            print(f"[{symbol}] SKIPPED — data unavailable: {exc}")
            continue

        should_trade = abs(ensemble_signal) > trade_threshold
        print(f"[{symbol}] ensemble_signal={ensemble_signal:+.3f} close={latest_close:.2f} trade={should_trade}")

        if not should_trade:
            continue

        proposal = TradeProposal(
            symbol=symbol,
            is_crypto=False,
            raw_kelly_weight=abs(ensemble_signal),
            regime_confidence=pt_cfg["default_regime_confidence"],
        )
        decision = risk_engine.evaluate(proposal, current_crypto_allocation=0.0, daily_pnl_pct=daily_pnl_pct)
        audit.log_risk_decision(symbol, decision.approved, decision.reasons)

        if not decision.approved:
            print(f"[{symbol}] BLOCKED by risk engine: {decision.reasons}")
            continue

        side = "buy" if ensemble_signal > 0 else "sell"
        stop_loss_price = (
            latest_close * (1 - pt_cfg["stop_loss_pct"])
            if side == "buy"
            else latest_close * (1 + pt_cfg["stop_loss_pct"])
        )

        if args.dry_run:
            notional = decision.sized_weight * 100_000  # illustrative equity for dry-run sizing
            print(f"[{symbol}] DRY RUN would submit {side} ~${notional:,.0f} notional, stop @ {stop_loss_price:.2f}")
            continue

        qty = max(int((decision.sized_weight * account_equity) / latest_close), 0)
        if qty == 0:
            print(f"[{symbol}] sized position rounds to 0 shares at current equity — skipping")
            continue

        order_request = OrderRequest(symbol=symbol, side=side, qty=qty, stop_loss_price=round(stop_loss_price, 2))
        result = execution.submit_order(order_request)
        audit.log_trade(symbol, side, qty, result.filled_avg_price, result.order_id)
        print(f"[{symbol}] SUBMITTED {side} {qty} shares, order_id={result.order_id}, status={result.status}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
