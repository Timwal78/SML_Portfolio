# NATS v2.0 — API Reference

## Non-negotiables (do not compromise — all 15)

1. Paper trading first: minimum 90 days live paper before any real capital.
2. Max position size: no single trade > 2% of portfolio, ever.
3. Daily circuit breaker: halt all trading if daily P&L < -3%.
4. No overnight gaps unhedged: all positions must have stop-losses.
5. API key security: keys in `.env` only, never hardcoded. Use `python-dotenv`.
6. Audit trail: every signal, every trade, every decision logged immutably to JSONL.
7. Regime validation: do not trade if regime confidence < 60%.
8. Crypto is satellite: max 10% allocation to crypto strategies.
9. Rebalance frequency: weights rebalanced weekly, not daily.
10. Human override: kill switch always accessible. No exceptions.
11. No live deployment until PSR > 0.95 on 5-year backtest.
12. Deflated Sharpe must be computed and logged before any live trade.
13. All factor shifts must be code-reviewed for lookahead (automated lint check).
14. Regime model trained only on expanding window — never full-sample fit.
15. Monte Carlo p-value < 0.05 required per agent before inclusion in ensemble.

## Interface contracts

### `BaseAgent` (`src/agents/base_agent.py`)

```python
class BaseAgent(ABC):
    metadata: AgentMetadata  # agent_id, name, thesis, factors, edge, data_sources, long_only

    def generate_signal(self, factor_frame: pd.DataFrame) -> pd.Series:
        """Returns {-1, 0, +1} (or {0, +1} if long_only) per bar."""

    def validate_output(self, signal: pd.Series) -> None:
        """Raises ValueError if signal contains values outside the allowed set."""
```

All 20 concrete agents (`src/agents/agent_01_*.py` .. `agent_20_*.py`) implement this
contract. `generate_signal` currently raises `NotImplementedError` — see each
module's docstring for its exact signal rule, factor list, and any spec
constraint (e.g. Agent 13's announced-date requirement, Agent 15's monthly
cointegration re-validation, Agent 20's long-only / 3-of-5-indicator rule).

### Factor functions (`src/factors/*.py`)

Every public factor function takes raw (or upstream-fetched) `pd.Series`/`pd.DataFrame`
inputs and returns a `.shift(1)`'d `pd.Series` — see each module's docstring.
Run the anti-lookahead lint before wiring any factor into an agent:

```bash
python -m src.factors.lint_check
# or
pytest tests/unit/test_factors_lint.py
```

### `RiskEngine` (`src/risk/risk_engine.py`)

```python
engine = RiskEngine(RiskConfig(...))  # reads defaults matching config.yaml's risk: block
decision = engine.evaluate(TradeProposal(...), current_crypto_allocation, daily_pnl_pct)
# decision.approved, decision.sized_weight, decision.reasons
```

Rejects trades when: the circuit breaker has tripped, regime confidence is
below `regime_confidence_min`, or (for crypto) the allocation cap would be
breached. Position sizing is quarter-Kelly (`kelly_fraction`), capped at
`max_position_pct`.

### `MetaLearningEnsemble` (`src/ensemble/meta_learning_engine.py`)

```python
ensemble = MetaLearningEnsemble(EnsembleConfig(...), base_allocations)
weights = ensemble.compute_weights(rolling_30d_sharpe)  # dict[agent_name, weight]
weighted_signal, should_trade = ensemble.ensemble_signal(agent_signals, weights)
```

Weights are water-filled to respect `min_agent_weight`/`max_agent_weight`
while summing to `1 - shadow_flow_cap`. ShadowFlowHunter is excluded from
the vote and always held at exactly `shadow_flow_cap`.

### `ShadowFlowHunter` model (`src/shadow_flow/shadow_flow_hunter.py`)

```python
result = evaluate(ticker, ftd_zscore, etf_basket_divergence, dark_pool_pct,
                   synthetic_short_score, short_int_divergence)
# result.signal is always 0 or 1 — never -1
should_exit(indicators_normalized_count, unrealized_pnl_pct)
```

### Validation gates (`src/validation/*.py`)

| Function | Gate |
|----------|------|
| `probabilistic_sharpe_ratio(returns)` | PSR > 0.95 required (spec #11) |
| `deflated_sharpe_ratio(returns, n_trials, trial_sharpe_std)` | Deflated SR > 0.90 required (spec #12) |
| `monte_carlo_sharpe_pvalue(returns)` | p < 0.05 required per agent (spec #15) |
| `benjamini_hochberg(p_values)` | FDR correction across all 20 agents (spec UPGRADE 6) |
| `PurgedKFold(n_splits, embargo_bars).split(n)` | Prevents regime leakage at fold boundaries (spec UPGRADE 3) |
| `check_regime_coverage(regime_labels)` | Backtest window must cover bull/bear/high-vol/crisis minimums (spec UPGRADE 10) |

Run `scripts/validate.py --returns <csv>` to evaluate all gates against a
completed backtest run.

### Data clients (`src/data/*.py`)

Each client subclasses `BaseDataClient`, declares `required_env_vars`, and
raises `UpstreamUnavailableError` — never fabricated data — on failure or
missing credentials. See `.env.example` for the full credential list.

### Execution adapters (`src/execution/*.py`)

`TradierExecutionAdapter` and `AlpacaExecutionAdapter` implement
`BaseExecutionAdapter.submit_order/get_position/cancel_all_orders`.
`cancel_all_orders` is the kill-switch primitive (spec non-negotiable #10)
and must be implemented before any paper or live trading begins.

### Audit trail (`src/monitoring/audit_log.py`)

```python
logger = AuditLogger(Path("logs/audit.jsonl"))
logger.log_signal(agent_name, symbol, signal, confidence)
logger.log_trade(symbol, side, qty, price, order_id)
logger.log_risk_decision(symbol, approved, reasons)
logger.log_validation_gate(gate_name, passed, value, threshold)
```

Append-only JSONL. Every signal, trade, and decision must be logged (spec
non-negotiable #6).

## What's implemented vs. stubbed in this scaffold

| Area | Status |
|------|--------|
| `src/factors/*` | Fully implemented (pure pandas transforms, anti-lookahead lint passes) |
| `src/risk/*` | Fully implemented |
| `src/validation/*` | Fully implemented |
| `src/ensemble/*` | Fully implemented (used by the full 20-agent swarm; the v1 paper-trading loop uses a simpler equal-weight bootstrap — see below) |
| `src/shadow_flow/*` | Fully implemented (scoring model only — factor inputs come from `src/factors/`) |
| `src/regime/*` | Implemented; centroid-to-label heuristic in `_label_clusters` needs Phase 2 tuning against real regime features. Not yet wired into `scripts/paper_trade.py` (uses a fixed `default_regime_confidence` from config.yaml in the interim) |
| `src/agents/agent_01,02,03,07,08,09,10,11_*.py` | **Fully implemented** — MomentumHunter, MeanReversionSniper, VolRegimeDetector, SeasonalityExpert, BollingerBouncer, VolumeConfirmer, TrendFollower, FearGreedContrarian. Only need free Yahoo data. |
| `src/agents/` (remaining 12) | Interface + metadata complete; `generate_signal` bodies are stubs — need Tradier/Polygon/Alpha Vantage/Binance/FINRA/SEC EDGAR credentials |
| `src/data/yahoo_client.py` | **Fully implemented** (yfinance, no API key required) |
| `src/data/` (Tradier, Polygon, Alpaca market-data, Alpha Vantage, Binance, SEC EDGAR, FINRA) | Interface only; live HTTP calls are stubs pending credentials |
| `src/execution/alpaca_adapter.py` | **Fully implemented** (alpaca-py SDK, bracket orders with stop-loss leg, paper-only by construction) |
| `src/execution/tradier_adapter.py` | Interface only; stub pending Tradier credentials |
| `src/pipeline/factor_builder.py` | **Fully implemented** — builds the factor frame for the 8 Yahoo-only agents |
| `src/monitoring/metrics.py`, `audit_log.py` | Fully implemented |
| `scripts/paper_trade.py` | **Fully implemented and runnable** — daily loop: Yahoo data → factors → 8 agents → equal-weight ensemble → risk gate → Alpaca paper order → audit log. Requires `ALPACA_API_KEY`/`ALPACA_SECRET_KEY` env vars; run with `--dry-run` to see signals without submitting orders. **This sandboxed dev session cannot reach any external API (Yahoo, Alpaca, Tradier, etc. all blocked by network policy) — this script has only been verified with synthetic/mocked data here. It must be run somewhere with real internet access** (see `render.yaml`, a Render Cron Job) before being trusted with real paper orders. |
| `scripts/backtest.py` | Orchestration stub — wire once more agents/data sources are implemented |
| `scripts/live_trade.py` | Intentionally locked/unimplemented until the Phase 5 PSR/DSR gate passes |
| `scripts/validate.py`, `monitor.py` | Fully implemented and runnable today |

### v1 paper-trading launch scope

`config.yaml`'s `paper_trading:` block controls the initial launch: a
3-symbol universe (SPY, QQQ, IWM), the 8 Yahoo-only agents, and a fixed
`default_regime_confidence` (the real expanding-window regime detector
isn't wired into the loop yet). Ensemble weighting is a straight average
across the 8 agents — the full `MetaLearningEnsemble` weekly-rebalance
scheme needs live rolling-30-day-Sharpe history that doesn't exist on day
one. Revisit both simplifications once enough paper-trading history
accumulates and the remaining 12 agents' data sources are live.

Deploy via Render as a **Cron Job** (`render.yaml`, `nats-paper-trader`),
not a long-running worker — the script runs once per invocation and exits;
scheduling it daily is the correct pattern for a system whose factors are
all daily bars.
