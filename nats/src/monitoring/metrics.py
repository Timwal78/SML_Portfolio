"""Prometheus metrics for NATS v2.0. Scraped by the Prometheus + Grafana
stack referenced in the tech-stack spec. Metric objects are module-level
singletons so any part of the system can import and update them.
"""

from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram

signals_generated_total = Counter(
    "nats_signals_generated_total", "Signals generated per agent", ["agent_name", "signal_value"]
)

trades_executed_total = Counter(
    "nats_trades_executed_total", "Trades executed", ["symbol", "side"]
)

circuit_breaker_trips_total = Counter(
    "nats_circuit_breaker_trips_total", "Number of times the daily circuit breaker has tripped"
)

portfolio_pnl_pct = Gauge(
    "nats_portfolio_pnl_pct", "Current session P&L as a fraction of portfolio value"
)

ensemble_weight = Gauge(
    "nats_ensemble_weight", "Current ensemble weight per agent", ["agent_name"]
)

regime_confidence = Gauge(
    "nats_regime_confidence", "Current regime detector confidence"
)

order_latency_seconds = Histogram(
    "nats_order_latency_seconds", "Time from signal to order acknowledgement", ["adapter"]
)
