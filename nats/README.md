# NATS v2.0 — Nobel Autonomous Trading Swarm

Production-grade, 20-agent, multi-strategy quantitative trading system for
Script Master Labs. Heterogeneous strategy ensemble + cross-asset regime
detection + meta-learning weight adaptation, gated behind institutional
statistical validation (PSR, Deflated Sharpe, Monte Carlo significance)
before any live capital is deployed.

> **Status:** Scaffold (Phase 0). Module interfaces, config, and test
> layout are in place per the full build spec. Agent logic, data-provider
> clients, and validation math are stubbed with `NotImplementedError` and
> must be implemented per-module before Phase 1 sign-off. See
> `docs/API_REFERENCE.md` for interface contracts and the roadmap below.

## Architecture

```
                         ┌─────────────────────┐
                         │   data/ (9 sources)  │
                         │ Tradier · Polygon    │
                         │ Alpaca · AlphaVantage│
                         │ Binance · Yahoo      │
                         │ SEC EDGAR · FINRA    │
                         └──────────┬───────────┘
                                    ▼
                         ┌─────────────────────┐
                         │ factors/ (50+, all   │
                         │ .shift(1) enforced)  │
                         └──────────┬───────────┘
                                    ▼
        ┌───────────────────────────────────────────────────┐
        │              agents/ (20 heterogeneous)            │
        │  01-12 original · 13-19 new · 20 ShadowFlowHunter  │
        │  each: stateless, outputs {-1, 0, +1}               │
        └───────────────────────┬───────────────────────────┘
                                 ▼
                     ┌───────────────────────┐
                     │  regime/ (expanding-   │
                     │  window KMeans, 4      │
                     │  clusters)             │
                     └───────────┬────────────┘
                                 ▼
                     ┌───────────────────────┐
                     │ ensemble/ (meta-       │
                     │ learning weights,      │
                     │ weekly rebalance)      │
                     └───────────┬────────────┘
                                 ▼
              ┌──────────────────────────────────────┐
              │ validation/ (PSR, DSR, Monte Carlo,   │
              │ purged k-fold, FDR, regime coverage)  │
              │        — gates live deployment —      │
              └───────────────┬────────────────────────┘
                               ▼
                  ┌─────────────────────────┐
                  │ risk/ (circuit breaker,  │
                  │ VaR, position sizing)    │
                  └────────────┬─────────────┘
                               ▼
                  ┌─────────────────────────┐
                  │ execution/ (Tradier +    │
                  │ Alpaca adapters)         │
                  └─────────────────────────┘

  shadow_flow/  — Agent 20 dedicated module (FTD, dark pool, synthetic
                  short, etc). Overlay signal, 1% cap, not in ensemble vote.
  monitoring/   — Prometheus metrics + structured JSONL audit trail.
```

## Non-Negotiables

See the full list of 15 non-negotiable constraints in
`docs/API_REFERENCE.md#non-negotiables`. Highlights: max 2% position size,
-3% daily circuit breaker, 90-day minimum paper trading, PSR > 0.95 and
Deflated Sharpe > 0.90 required before any live trade, all factors must be
`.shift(1)` (anti-lookahead), regime model trained only on expanding
windows.

## Setup

```bash
cd nats
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in real API keys — never commit .env
```

### Docker

```bash
docker build -t nats-v2 .
docker run --env-file .env nats-v2
```

## Roadmap

| Phase | Weeks | Deliverable |
|-------|-------|-------------|
| 1 | 1-2 | Data pipeline + 50 factors (shift(1) validated) + single-agent backtests |
| 2 | 3-4 | 20-agent swarm + ensemble + PSR/DSR validation gates |
| 3 | 5-6 | Risk engine + execution layer + monitoring dashboard |
| 4 | 7-8 | Paper trading begins (90-day minimum clock starts) |
| 5 | Month 3+ | PSR > 0.95 gate check → live trading, small capital |
| 6 | Month 4+ | Research publication + scaling + new asset classes |

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/backtest.py` | Full 5-year backtest runner |
| `scripts/paper_trade.py` | Live paper trading loop |
| `scripts/live_trade.py` | Production trading — locked behind PSR/DSR gate |
| `scripts/validate.py` | Runs all 10 stress-test upgrades |
| `scripts/monitor.py` | Dashboard + alerting |

## Realistic Performance Targets (post-cost, 5-year validated)

| Metric | Target |
|--------|--------|
| Sharpe Ratio | 1.5 – 2.2 |
| Annual Return | 8% – 15% |
| Max Drawdown | < 15% |
| Win Rate | 52% – 56% |
| PSR | > 0.95 |
| Deflated SR | > 0.90 |

Any backtest Sharpe > 2.5 must be investigated for lookahead bias before
being trusted.

## Sovereign Data Policy

This module lives inside a Script Master Labs sovereign repo. Live-data
mandate (`AGENT_STANDARDS/SOVEREIGN_DATA_POLICY.md`) applies once real
implementations replace these stubs: no hardcoded signals, no mock data
behind paid surfaces, and upstream failures must return real errors —
never fabricated fallbacks.
