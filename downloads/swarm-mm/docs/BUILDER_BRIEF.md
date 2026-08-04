# Swarm MM — Builder Brief (locked)

Source: operator gamechangers brief. Implementation lives in `/workspace/swarm-mm`.

## Recommended sequence (executing)

1. **Month 1 / now:** Variant D live API + paper leaderboard + upgrade funnel
2. **Month 2:** Variant A signal monetization ($19/mo + $0.001 calls)
3. **Month 3:** Variant C B2B tenant license
4. **Month 4:** Variant B crypto vault (legal + audit gate)

## Shared engine guarantees

- One ladder algorithm (`core/engine.py`) for A/C/D and B illustrative books
- Quotes: live if `SWARM_MM_QUOTE_URL` set, else `synthetic_disclosed` (never faked as live)
- State: memory + optional Redis
- payTo: `0x72330994f379a71542e7bd5a4cf99a9d9743f4aa` Base USDC

## Out of scope for this MVP

- Live brokerage order placement (A remains signal-only)
- On-chain vault bytecode (B scaffold only)
- WebSocket fanout (HTTP first)
- Rust execution hot path
