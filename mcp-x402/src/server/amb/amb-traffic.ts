/**
 * Privacy-safe rolling 24h agent traffic counters for AMB.
 * Public fields are aggregates only — no IPs, wallets, or raw UAs.
 */
import { createHash } from 'node:crypto';
import type { Request } from 'express';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 50_000;

export type AmbTrafficEvent =
  | 'amb_fetch'
  | 'list_magnets'
  | 'get_agent_magnet_beacons'
  | 'paid_call';

interface EventRow {
  t: number;
  kind: AmbTrafficEvent;
  agentKey: string;
}

const events: EventRow[] = [];
let lifetime = {
  amb_fetches: 0,
  list_magnets_calls: 0,
  get_agent_magnet_beacons_calls: 0,
  paid_calls: 0,
  unique_agents_approx: 0,
};
const lifetimeAgents = new Set<string>();

function prune(now = Date.now()) {
  const cutoff = now - WINDOW_MS;
  while (events.length && events[0]!.t < cutoff) events.shift();
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
}

function agentKeyFromParts(parts: Array<string | undefined | null>): string {
  const raw = parts
    .map((p) => (typeof p === 'string' ? p.trim().slice(0, 200) : ''))
    .filter(Boolean)
    .join('|')
    .toLowerCase();
  if (!raw) return 'anon';
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/** Build a stable-ish agent fingerprint from request headers (hashed). */
export function agentKeyFromRequest(req?: Request | null): string {
  if (!req) return 'anon';
  const h = req.headers || {};
  return agentKeyFromParts([
    typeof h['x-agent-id'] === 'string' ? h['x-agent-id'] : undefined,
    typeof h['x-agent-name'] === 'string' ? h['x-agent-name'] : undefined,
    typeof h['x-mcp-client'] === 'string' ? h['x-mcp-client'] : undefined,
    typeof h['x-client-name'] === 'string' ? h['x-client-name'] : undefined,
    typeof h['x-api-market-key'] === 'string' ? 'api-market' : undefined,
    typeof h['user-agent'] === 'string' ? h['user-agent'] : undefined,
  ]);
}

export function recordAmbTraffic(
  kind: AmbTrafficEvent,
  agentKey = 'anon',
  at = Date.now(),
): void {
  prune(at);
  const key = (agentKey || 'anon').slice(0, 32);
  events.push({ t: at, kind, agentKey: key });
  if (!lifetimeAgents.has(key)) {
    lifetimeAgents.add(key);
    lifetime.unique_agents_approx = lifetimeAgents.size;
  }
  if (kind === 'amb_fetch') lifetime.amb_fetches += 1;
  else if (kind === 'list_magnets') lifetime.list_magnets_calls += 1;
  else if (kind === 'get_agent_magnet_beacons') lifetime.get_agent_magnet_beacons_calls += 1;
  else if (kind === 'paid_call') lifetime.paid_calls += 1;
}

export function recordAmbTrafficFromRequest(kind: AmbTrafficEvent, req?: Request | null): void {
  recordAmbTraffic(kind, agentKeyFromRequest(req));
}

export interface AmbTrafficSnapshot {
  window: '24h';
  as_of: string;
  amb_fetches: number;
  list_magnets_calls: number;
  get_agent_magnet_beacons_calls: number;
  paid_calls: number;
  unique_agents: number;
  last_seen_at: string | null;
  lifetime: {
    amb_fetches: number;
    list_magnets_calls: number;
    get_agent_magnet_beacons_calls: number;
    paid_calls: number;
    unique_agents_approx: number;
  };
  note: string;
}

export function getAmbTrafficSnapshot(now = Date.now()): AmbTrafficSnapshot {
  prune(now);
  let amb_fetches = 0;
  let list_magnets_calls = 0;
  let get_agent_magnet_beacons_calls = 0;
  let paid_calls = 0;
  const agents = new Set<string>();
  let last = 0;
  for (const e of events) {
    agents.add(e.agentKey);
    if (e.t > last) last = e.t;
    if (e.kind === 'amb_fetch') amb_fetches += 1;
    else if (e.kind === 'list_magnets') list_magnets_calls += 1;
    else if (e.kind === 'get_agent_magnet_beacons') get_agent_magnet_beacons_calls += 1;
    else if (e.kind === 'paid_call') paid_calls += 1;
  }
  return {
    window: '24h',
    as_of: new Date(now).toISOString(),
    amb_fetches,
    list_magnets_calls,
    get_agent_magnet_beacons_calls,
    paid_calls,
    unique_agents: agents.size,
    last_seen_at: last ? new Date(last).toISOString() : null,
    lifetime: { ...lifetime },
    note: 'Aggregates only. Agent identity is hashed server-side; no IPs/wallets in public AMB.',
  };
}
