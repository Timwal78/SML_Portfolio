/**
 * Cognitive Friction API — intentional slowdowns for high-stakes agent acts.
 * Not a safety rail theater: deliberation window + devil's advocate + reconfirm.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export type FrictionType = 'deliberation_ritual' | 'cooling' | 'ceremonial' | 'devil_advocate';
export type FrictionIntensity = 'light' | 'standard' | 'ceremonial';

const DATA_DIR = process.env['FRICTION_DATA_DIR'] || join(process.cwd(), '.data', 'friction');
try { mkdirSync(DATA_DIR, { recursive: true }); } catch { /* */ }

interface Session {
  id: string;
  agent_id: string;
  action: string;
  friction_type: FrictionType;
  intensity: FrictionIntensity;
  created_at: string;
  unlock_at: string;
  cooling_ms: number;
  status: 'cooling' | 'ready' | 'confirmed' | 'expired' | 'aborted';
  devil_advocate: string[];
  explanation?: string;
  reconfirm_token?: string;
  confirmed_at?: string;
  payer?: string;
}

const sessions = new Map<string, Session>();
const path = join(DATA_DIR, 'sessions.json');

function load() {
  if (!existsSync(path)) return;
  try {
    const arr = JSON.parse(readFileSync(path, 'utf8')) as Session[];
    for (const s of arr) sessions.set(s.id, s);
  } catch { /* */ }
}
function save() {
  try {
    writeFileSync(path, JSON.stringify([...sessions.values()].slice(-500), null, 0));
  } catch { /* */ }
}
load();

const COOLING: Record<FrictionIntensity, number> = {
  light: 5_000,
  standard: 30_000,
  ceremonial: 90_000,
};

function advocates(action: string, intensity: FrictionIntensity): string[] {
  const base = [
    `What if "${action}" is irreversible and wrong?`,
    'Have you verified the counterparty and amount on-chain?',
    'Would you still do this after a 24h delay?',
    'Is there a cheaper / safer alternative (escrow, delay, reject)?',
  ];
  if (intensity === 'ceremonial') {
    base.push('Name the failure mode you are most afraid of.');
    base.push('Who is harmed if this succeeds for the wrong reason?');
  }
  return base;
}

export function frictionHealth() {
  const now = Date.now();
  let cooling = 0, ready = 0, confirmed = 0;
  for (const s of sessions.values()) {
    if (s.status === 'cooling' && Date.parse(s.unlock_at) <= now) s.status = 'ready';
    if (s.status === 'cooling') cooling++;
    else if (s.status === 'ready') ready++;
    else if (s.status === 'confirmed') confirmed++;
  }
  return {
    ok: true,
    product: 'cognitive-friction',
    novel_id: 6,
    package: 'NEGATIVE_SPACE_14',
    sessions: sessions.size,
    cooling,
    ready,
    confirmed,
    intensities: COOLING,
  };
}

export function applyFriction(input: {
  agent_id: string;
  action: string;
  friction_type?: FrictionType;
  intensity?: FrictionIntensity;
  amount_usd?: number;
  payer?: string;
}) {
  const agent_id = String(input.agent_id || 'agent').slice(0, 128);
  const action = String(input.action || 'unspecified').slice(0, 256);
  let intensity: FrictionIntensity = input.intensity || 'standard';
  // Auto-escalate for high notional
  if (typeof input.amount_usd === 'number' && input.amount_usd >= 50) intensity = 'ceremonial';
  else if (typeof input.amount_usd === 'number' && input.amount_usd >= 5 && intensity === 'light') intensity = 'standard';

  const friction_type: FrictionType = input.friction_type || (intensity === 'ceremonial' ? 'ceremonial' : 'deliberation_ritual');
  const cooling_ms = COOLING[intensity];
  const now = Date.now();
  const id = randomUUID();
  const reconfirm_token = randomUUID().replace(/-/g, '').slice(0, 16);
  const s: Session = {
    id,
    agent_id,
    action,
    friction_type,
    intensity,
    created_at: new Date(now).toISOString(),
    unlock_at: new Date(now + cooling_ms).toISOString(),
    cooling_ms,
    status: 'cooling',
    devil_advocate: advocates(action, intensity),
    reconfirm_token,
    payer: input.payer,
  };
  sessions.set(id, s);
  save();
  return {
    session_id: id,
    agent_id,
    action,
    friction_type,
    intensity,
    status: s.status,
    cooling_ms,
    unlock_at: s.unlock_at,
    devil_advocate: s.devil_advocate,
    ritual: {
      step_1: 'Explain why this action is necessary (POST /x402/friction/explain).',
      step_2: `Wait until unlock_at (${s.unlock_at}).`,
      step_3: 'Re-confirm with non-default token (POST /x402/friction/confirm).',
    },
    reconfirm_token: s.reconfirm_token,
    reconfirm_hint: 'Use reconfirm_token after unlock_at with accept_risk:true.',
    amount_usd: input.amount_usd ?? null,
    package: 'NEGATIVE_SPACE_14',
  };
}

export function explainFriction(input: { session_id: string; explanation: string; agent_id?: string }) {
  const s = sessions.get(input.session_id);
  if (!s) return { error: 'session_not_found' as const };
  if (input.agent_id && input.agent_id !== s.agent_id) return { error: 'agent_mismatch' as const };
  s.explanation = String(input.explanation || '').slice(0, 2000);
  if (Date.parse(s.unlock_at) <= Date.now() && s.status === 'cooling') s.status = 'ready';
  save();
  return {
    session_id: s.id,
    status: s.status,
    explanation_recorded: true,
    unlock_at: s.unlock_at,
    remaining_ms: Math.max(0, Date.parse(s.unlock_at) - Date.now()),
    devil_advocate: s.devil_advocate,
  };
}

export function statusFriction(session_id: string) {
  const s = sessions.get(session_id);
  if (!s) return { error: 'session_not_found' as const };
  if (s.status === 'cooling' && Date.parse(s.unlock_at) <= Date.now()) {
    s.status = 'ready';
    save();
  }
  // expire after 1h past unlock if never confirmed
  if (s.status !== 'confirmed' && Date.parse(s.unlock_at) + 3_600_000 < Date.now()) {
    s.status = 'expired';
    save();
  }
  return {
    session_id: s.id,
    agent_id: s.agent_id,
    action: s.action,
    status: s.status,
    intensity: s.intensity,
    unlock_at: s.unlock_at,
    remaining_ms: Math.max(0, Date.parse(s.unlock_at) - Date.now()),
    has_explanation: Boolean(s.explanation),
    confirmed_at: s.confirmed_at ?? null,
  };
}

export function confirmFriction(input: {
  session_id: string;
  reconfirm_token: string;
  agent_id?: string;
  accept_risk?: boolean;
}) {
  const s = sessions.get(input.session_id);
  if (!s) return { error: 'session_not_found' as const };
  if (input.agent_id && input.agent_id !== s.agent_id) return { error: 'agent_mismatch' as const };
  if (s.status === 'expired' || s.status === 'aborted') return { error: 'session_closed', status: s.status };
  if (s.status === 'confirmed') return { error: 'already_confirmed', confirmed_at: s.confirmed_at };
  if (Date.parse(s.unlock_at) > Date.now()) {
    return {
      error: 'still_cooling',
      unlock_at: s.unlock_at,
      remaining_ms: Date.parse(s.unlock_at) - Date.now(),
    };
  }
  if (!s.explanation || s.explanation.trim().length < 12) {
    return { error: 'explanation_required', detail: 'POST /x402/friction/explain with >=12 chars first.' };
  }
  if (!input.accept_risk) {
    return { error: 'accept_risk_required', detail: 'Pass accept_risk:true (non-default).' };
  }
  if (input.reconfirm_token !== s.reconfirm_token) {
    return { error: 'bad_reconfirm_token' };
  }
  s.status = 'ready';
  s.status = 'confirmed';
  s.confirmed_at = new Date().toISOString();
  save();
  return {
    ok: true,
    session_id: s.id,
    status: 'confirmed',
    action: s.action,
    agent_id: s.agent_id,
    intensity: s.intensity,
    confirmed_at: s.confirmed_at,
    clearance: {
      may_proceed: true,
      friction_cleared: true,
      note: 'Cognitive friction satisfied. Proceed with high-stakes act.',
    },
    package: 'NEGATIVE_SPACE_14',
  };
}
