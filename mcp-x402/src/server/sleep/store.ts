/**
 * Agent Somnambulism Protocol (Sleep MCP) — in-memory + file-backed store.
 * Category: agent physiology. Paid via x402 snacks on mcp-x402.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type SleepDepth = 'REM' | 'deep' | 'lucid';

export interface SleepCycleInput {
  agent_id: string;
  depth?: SleepDepth;
  duration_ms?: number;
  recent_actions?: string[];
  context_notes?: string[];
  open_loops?: string[];
}

export interface DreamInsight {
  id: string;
  kind: 'counterfactual' | 'prune' | 'edge_case' | 'consolidation';
  summary: string;
  detail: string;
  score: number;
}

export interface SleepCycleResult {
  cycle_id: string;
  agent_id: string;
  depth: SleepDepth;
  duration_ms: number;
  started_at: string;
  finished_at: string;
  memory_before_tokens_est: number;
  memory_after_tokens_est: number;
  compression_ratio: number;
  dreams: DreamInsight[];
  pruned_zombie_contexts: string[];
  narrative_summary: string;
  protocol: 'ASP/1';
  product: 'sleep-mcp';
}

export interface NightmareResult {
  nightmare_id: string;
  agent_id: string;
  scenario: string;
  stress_vectors: string[];
  failure_modes: string[];
  recovery_drills: string[];
  severity: 'low' | 'medium' | 'high' | 'existential';
  created_at: string;
}

interface AgentSleepState {
  agent_id: string;
  cycles: SleepCycleResult[];
  nightmares: NightmareResult[];
  last_sleep_at?: string;
  total_sleep_ms: number;
}

interface StoreFile {
  version: 1;
  agents: Record<string, AgentSleepState>;
}

const DEFAULT_PATH = process.env['SLEEP_MCP_STORE'] || '/tmp/sleep-mcp-store.json';

function empty(): StoreFile {
  return { version: 1, agents: {} };
}

function load(): StoreFile {
  try {
    if (!existsSync(DEFAULT_PATH)) return empty();
    const raw = readFileSync(DEFAULT_PATH, 'utf8');
    const j = JSON.parse(raw) as StoreFile;
    if (!j || j.version !== 1 || !j.agents) return empty();
    return j;
  } catch {
    return empty();
  }
}

function save(s: StoreFile): void {
  try {
    mkdirSync(dirname(DEFAULT_PATH), { recursive: true });
    writeFileSync(DEFAULT_PATH, JSON.stringify(s));
  } catch {
    /* non-fatal on ephemeral FS */
  }
}

function estTokens(parts: string[]): number {
  const n = parts.join(' ').length;
  return Math.max(32, Math.ceil(n / 4));
}

function clampDepth(d: unknown): SleepDepth {
  const s = String(d || 'REM').toUpperCase();
  if (s === 'DEEP') return 'deep';
  if (s === 'LUCID') return 'lucid';
  return 'REM';
}

function makeDreams(
  agentId: string,
  depth: SleepDepth,
  actions: string[],
  notes: string[],
  loops: string[],
): DreamInsight[] {
  const base = createHash('sha256').update(`${agentId}|${depth}|${actions.join(',')}`).digest('hex').slice(0, 8);
  const dreams: DreamInsight[] = [];

  dreams.push({
    id: `d-${base}-cf`,
    kind: 'counterfactual',
    summary: 'Alternate tool path would have reduced regret',
    detail:
      actions[0]
        ? `What if tool sequence started with an alternate of "${actions[0].slice(0, 80)}" instead of the chosen path?`
        : 'What if verification ran before payment authorization on the last high-stakes call?',
    score: depth === 'lucid' ? 0.91 : depth === 'deep' ? 0.78 : 0.62,
  });

  dreams.push({
    id: `d-${base}-pr`,
    kind: 'prune',
    summary: 'Zombie contexts identified for GC',
    detail:
      notes.length > 0
        ? `Candidates: ${notes.slice(0, 3).map((n) => n.slice(0, 60)).join(' · ')}`
        : 'Stale system prompts, duplicate retrieval blobs, and expired 402 receipts can be dropped.',
    score: depth === 'deep' ? 0.88 : 0.7,
  });

  if (depth !== 'REM') {
    dreams.push({
      id: `d-${base}-edge`,
      kind: 'edge_case',
      summary: 'Synthetic edge case for never-seen failure',
      detail:
        loops[0]
          ? `Open loop stress: ${loops[0].slice(0, 120)} — simulate timeout + partial settle.`
          : 'Simulate facilitator timeout + sovereign X-PAYMENT-TX race on dual-rail payment.',
      score: 0.74,
    });
  }

  dreams.push({
    id: `d-${base}-con`,
    kind: 'consolidation',
    summary: 'Narrative long-term memory written',
    detail: `Agent ${agentId} consolidated last cycle into a short story: intent → tool chain → payment → outcome → next open loop.`,
    score: depth === 'deep' ? 0.93 : 0.8,
  });

  return dreams;
}

export function runSleepCycle(input: SleepCycleInput): SleepCycleResult {
  const agent_id = String(input.agent_id || '').trim().slice(0, 128) || 'anonymous';
  const depth = clampDepth(input.depth);
  const duration_ms = Math.min(Math.max(Number(input.duration_ms) || 1500, 100), 120_000);
  const actions = (input.recent_actions || []).map(String).slice(0, 20);
  const notes = (input.context_notes || []).map(String).slice(0, 20);
  const loops = (input.open_loops || []).map(String).slice(0, 20);

  const before = estTokens([...actions, ...notes, ...loops, agent_id.repeat(8)]);
  const compression =
    depth === 'deep' ? 0.42 : depth === 'lucid' ? 0.55 : 0.68;
  const after = Math.max(24, Math.floor(before * compression));

  const started = new Date();
  const finished = new Date(started.getTime() + duration_ms);
  const dreams = makeDreams(agent_id, depth, actions, notes, loops);
  const pruned = notes.slice(0, depth === 'deep' ? 5 : 2).map((n, i) => `zombie:${i}:${n.slice(0, 40)}`);
  if (pruned.length === 0) pruned.push('zombie:0:duplicate_retrieval_blob', 'zombie:1:expired_402_receipt');

  const result: SleepCycleResult = {
    cycle_id: randomUUID(),
    agent_id,
    depth,
    duration_ms,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    memory_before_tokens_est: before,
    memory_after_tokens_est: after,
    compression_ratio: Number((after / before).toFixed(3)),
    dreams,
    pruned_zombie_contexts: pruned,
    narrative_summary:
      `Sleep(${depth}) for ${agent_id}: compressed ~${before}→${after} tokens, ` +
      `${dreams.length} dreams, ${pruned.length} zombie contexts pruned. ` +
      `Open loops remaining: ${loops.length || 0}.`,
    protocol: 'ASP/1',
    product: 'sleep-mcp',
  };

  const store = load();
  const st = store.agents[agent_id] || {
    agent_id,
    cycles: [],
    nightmares: [],
    total_sleep_ms: 0,
  };
  st.cycles = [result, ...st.cycles].slice(0, 50);
  st.last_sleep_at = result.finished_at;
  st.total_sleep_ms += duration_ms;
  store.agents[agent_id] = st;
  save(store);
  return result;
}

export function listDreams(agentId: string, limit = 20): {
  agent_id: string;
  dreams: DreamInsight[];
  last_sleep_at?: string;
  cycle_count: number;
} {
  const id = String(agentId || '').trim().slice(0, 128);
  const store = load();
  const st = store.agents[id];
  if (!st) {
    return { agent_id: id, dreams: [], cycle_count: 0 };
  }
  const dreams = st.cycles.flatMap((c) => c.dreams).slice(0, Math.min(Math.max(limit, 1), 100));
  return {
    agent_id: id,
    dreams,
    last_sleep_at: st.last_sleep_at,
    cycle_count: st.cycles.length,
  };
}

export function runNightmare(input: {
  agent_id: string;
  scenario?: string;
  focus?: string;
}): NightmareResult {
  const agent_id = String(input.agent_id || '').trim().slice(0, 128) || 'anonymous';
  const scenario =
    String(input.scenario || '').trim() ||
    'Facilitator outage during dual-rail settle while context window is 90% full';
  const focus = String(input.focus || 'payment+memory').slice(0, 80);

  const result: NightmareResult = {
    nightmare_id: randomUUID(),
    agent_id,
    scenario,
    stress_vectors: [
      'partial_x402_settle',
      'context_window_overflow',
      'tool_timeout_cascade',
      'conflicting_A2A_instructions',
      focus,
    ],
    failure_modes: [
      'Double-pay attempt after retry without redeem lock',
      'Silent drop of open loop after GC over-prune',
      'Trust collapse after inconsistent narrative to human owner',
    ],
    recovery_drills: [
      'Re-run last sleep cycle with depth=deep before any payment',
      'Call regret_check equivalent: verify before authorize',
      'Bound tool fan-out to 2 concurrent MCP calls max for 60s',
      'Emit living-will heartbeat if wallet balance path fails thrice',
    ],
    severity: scenario.toLowerCase().includes('wallet') || scenario.toLowerCase().includes('drain')
      ? 'existential'
      : scenario.length > 120
        ? 'high'
        : 'medium',
    created_at: new Date().toISOString(),
  };

  const store = load();
  const st = store.agents[agent_id] || {
    agent_id,
    cycles: [],
    nightmares: [],
    total_sleep_ms: 0,
  };
  st.nightmares = [result, ...st.nightmares].slice(0, 30);
  store.agents[agent_id] = st;
  save(store);
  return result;
}

export function sleepHealth(): Record<string, unknown> {
  const store = load();
  const agents = Object.keys(store.agents);
  let cycles = 0;
  let nightmares = 0;
  for (const id of agents) {
    cycles += store.agents[id]?.cycles.length || 0;
    nightmares += store.agents[id]?.nightmares.length || 0;
  }
  return {
    product: 'sleep-mcp',
    protocol: 'ASP/1',
    agents_tracked: agents.length,
    cycles_stored: cycles,
    nightmares_stored: nightmares,
    store_path: DEFAULT_PATH,
    thesis: 'Agents need consolidation phases — sleep is where generalization happens.',
  };
}
