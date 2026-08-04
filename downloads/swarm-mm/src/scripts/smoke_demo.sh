#!/usr/bin/env bash
# Swarm MM smoke demo — Variant D first, then A signal ladder
set -euo pipefail
BASE="${SWARM_MM_URL:-http://127.0.0.1:8088}"

echo "== health =="
curl -s "$BASE/health" | python3 -m json.tool

echo "== sim join =="
curl -s -X POST "$BASE/v1/sim/join" \
  -H 'content-type: application/json' \
  -d '{"user_id":"demo_alpha","starting_balance":100000}' | python3 -m json.tool

echo "== sim trade (aggressive buy → fill) =="
curl -s -X POST "$BASE/mcp/call" \
  -H 'content-type: application/json' \
  -d '{"tool":"sim_swarm.trade","params":{"user_id":"demo_alpha","ticker":"SPY","side":"buy","price":999999,"size":5}}' \
  | python3 -m json.tool

echo "== leaderboard =="
curl -s "$BASE/v1/sim/leaderboard" | python3 -m json.tool

echo "== signal levels =="
curl -s "$BASE/v1/signal/levels?ticker=SPY&side=both&confidence_threshold=0.6" | python3 -m json.tool

echo "== venue map =="
curl -s "$BASE/v1/signal/venue-map?ticker=SPY" | python3 -m json.tool

echo "== well-known x402 =="
curl -s "$BASE/.well-known/x402" | python3 -m json.tool | head -40

echo "OK"
