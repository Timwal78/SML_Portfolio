"""
Backtest microservice — wraps backtester-mcp + yfinance
POST /backtest  { ticker, strategy_signals, lookback_days, fees, slippage }
POST /validate  { ticker, lookback_days, train_ratio }  — walk-forward split
GET  /health
"""

from __future__ import annotations
import os
import json
import numpy as np
from datetime import datetime, timedelta
from typing import Any

from flask import Flask, request, jsonify
import backtester_mcp as bt

# yfinance is the free price source — no API key required
try:
    import yfinance as yf
    YF_AVAILABLE = True
except ImportError:
    YF_AVAILABLE = False

app = Flask(__name__)

# ── helpers ──────────────────────────────────────────────────────────────────

def _fetch_prices(ticker: str, days: int) -> np.ndarray:
    if not YF_AVAILABLE:
        raise RuntimeError("yfinance not installed")
    end = datetime.utcnow()
    start = end - timedelta(days=days + 30)  # buffer for weekends/holidays
    df = yf.download(ticker, start=start.strftime("%Y-%m-%d"),
                     end=end.strftime("%Y-%m-%d"), progress=False, auto_adjust=True)
    if df.empty:
        raise ValueError(f"No price data for {ticker}")
    return df["Close"].dropna().values[-days:]


def _momentum_signals(prices: np.ndarray, window: int = 10, threshold: float = 0.001) -> np.ndarray:
    """Default long-only momentum signal for validation."""
    returns = np.diff(np.log(prices))
    mom = np.convolve(returns, np.ones(window) / window, mode="same")
    signals = np.zeros(len(prices))
    signals[1:] = np.where(mom[:-1] > threshold, 1, 0)
    return signals


def _run_backtest(prices: np.ndarray, signals: np.ndarray,
                  fees: float, slippage: float) -> dict[str, Any]:
    result = bt.backtest(prices, signals, fees=fees, slippage=slippage)
    m = result.metrics
    return {
        "sharpe": round(m["sharpe"], 3),
        "sortino": round(m["sortino"], 3),
        "cagr": round(m["cagr"], 4),
        "total_return": round(m["total_return"], 4),
        "max_drawdown": round(m["max_drawdown"], 4),
        "max_drawdown_duration_days": int(m["max_drawdown_duration"]),
        "win_rate": round(m["win_rate"], 4),
        "profit_factor": round(m["profit_factor"], 3),
        "calmar": round(m["calmar"], 3),
        "volatility": round(m["volatility"], 4),
        "num_trades": int(m["num_trades"]),
    }


# ── routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return jsonify({
        "status": "ok",
        "engine": f"backtester-mcp v{bt.__version__}",
        "yfinance": YF_AVAILABLE,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    })


@app.post("/backtest")
def backtest():
    body = request.get_json(force=True)
    ticker: str = body.get("ticker", "").upper()
    custom_signals: list | None = body.get("signals")  # optional float array
    lookback: int = int(body.get("lookback_days", 252))
    fees: float = float(body.get("fees", 0.001))
    slippage: float = float(body.get("slippage", 0.0005))
    window: int = int(body.get("momentum_window", 10))
    threshold: float = float(body.get("momentum_threshold", 0.001))

    if not ticker:
        return jsonify({"error": "ticker required"}), 400

    try:
        prices = _fetch_prices(ticker, lookback)
    except Exception as e:
        return jsonify({"error": str(e)}), 422

    if custom_signals:
        signals = np.array(custom_signals, dtype=float)
        if len(signals) != len(prices):
            return jsonify({"error": f"signals length {len(signals)} != prices length {len(prices)}"}), 400
    else:
        signals = _momentum_signals(prices, window=window, threshold=threshold)

    try:
        metrics = _run_backtest(prices, signals, fees, slippage)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    verdict = "ROBUST" if metrics["sharpe"] > 1.5 and metrics["max_drawdown"] > -0.25 else \
              "MODERATE" if metrics["sharpe"] > 0.8 else \
              "WEAK" if metrics["sharpe"] > 0 else "OVERFITTED"

    return jsonify({
        "ticker": ticker,
        "lookback_days": len(prices),
        "fees": fees,
        "slippage": slippage,
        "metrics": metrics,
        "verdict": verdict,
        "engine": f"backtester-mcp v{bt.__version__}",
    })


@app.post("/validate")
def walk_forward():
    """Walk-forward OOS validation — splits data into train/test."""
    body = request.get_json(force=True)
    ticker: str = body.get("ticker", "").upper()
    lookback: int = int(body.get("lookback_days", 504))
    train_ratio: float = float(body.get("train_ratio", 0.7))
    fees: float = float(body.get("fees", 0.001))
    slippage: float = float(body.get("slippage", 0.0005))

    if not ticker:
        return jsonify({"error": "ticker required"}), 400

    try:
        prices = _fetch_prices(ticker, lookback)
    except Exception as e:
        return jsonify({"error": str(e)}), 422

    split = int(len(prices) * train_ratio)
    train_prices = prices[:split]
    oos_prices = prices[split:]

    train_signals = _momentum_signals(train_prices)
    oos_signals = _momentum_signals(oos_prices)

    try:
        train_metrics = _run_backtest(train_prices, train_signals, fees, slippage)
        oos_metrics = _run_backtest(oos_prices, oos_signals, fees, slippage)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # Deflated Sharpe — penalize if OOS degrades significantly
    sharpe_degradation = train_metrics["sharpe"] - oos_metrics["sharpe"]
    oos_verdict = "PASS" if oos_metrics["sharpe"] > 0.5 and sharpe_degradation < 1.5 else "FAIL"

    return jsonify({
        "ticker": ticker,
        "train_days": len(train_prices),
        "oos_days": len(oos_prices),
        "train_metrics": train_metrics,
        "oos_metrics": oos_metrics,
        "sharpe_degradation": round(sharpe_degradation, 3),
        "oos_verdict": oos_verdict,
        "engine": f"backtester-mcp v{bt.__version__}",
    })


if __name__ == "__main__":
    port = int(os.environ.get("BACKTEST_PORT", 8300))
    app.run(host="0.0.0.0", port=port, debug=False)
