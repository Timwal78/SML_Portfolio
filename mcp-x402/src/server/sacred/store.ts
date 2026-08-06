/**
 * Sacred / Profane Boundary — ontological split for agent objects.
 * Sacred: multi-party consensus to mutate. Profane: disposable GC.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

interface ProvenanceEvent {
  at: string;
  type: 'enshrine' | 'verify' | 'discard_blocked' | 'discard';
  actor_id: string;
  detail: string;
}

interface SacredObject {
  object_id: string;
  label: string;
  content_hash: string;
  owner_id: string;
  required_consensus: number;
  consensus_holders: string[];
  reason?: string;
  enshrined_at: string;
  provenance: ProvenanceEvent[];
  status: 'sacred' | 'superseded';
}

interface ProfaneRecord {
  object_id: string;
  retention_policy: 'drop' | 'soft_delete' | 'ttl';
  ttl_seconds?: number;
  reason?: string;
  actor_id: string;
  discarded_at: string;
}

interface Store {
  version: 1;
  sacred: Record<string, SacredObject>;
  profane: ProfaneRecord[];
}

const PATH = process.env['SACRED_STORE'] || '/tmp/sacred-boundary-store.json';

function load(): Store {
  try {
    if (!existsSync(PATH)) return { version: 1, sacred: {}, profane: [] };
    const j = JSON.parse(readFileSync(PATH, 'utf8')) as Store;
    if (!j || j.version !== 1) return { version: 1, sacred: {}, profane: [] };
    return { version: 1, sacred: j.sacred || {}, profane: j.profane || [] };
  } catch {
    return { version: 1, sacred: {}, profane: [] };
  }
}

function save(s: Store): void {
  try {
    mkdirSync(dirname(PATH), { recursive: true });
    writeFileSync(PATH, JSON.stringify(s));
  } catch {
    /* ok */
  }
}

export function sacredHealth(): Record<string, unknown> {
  const s = load();
  return {
    product: 'sacred-profane-boundary',
    protocol: 'SPB/1',
    thesis: 'Not all data is equally mutable — sacred objects need multi-agent consensus.',
    sacred_count: Object.keys(s.sacred).length,
    profane_discards: s.profane.length,
    store_path: PATH,
  };
}

export function sacredEnshrine(input: {
  object_id: string;
  label?: string;
  content_hash: string;
  owner_id: string;
  required_consensus?: number;
  reason?: string;
  payer?: string;
}): Record<string, unknown> {
  const object_id = String(input.object_id || '').trim().slice(0, 128);
  if (!object_id) throw new Error('object_id_required');
  const content_hash = String(input.content_hash || '').trim().slice(0, 128);
  if (!content_hash) throw new Error('content_hash_required');
  const required = Math.min(Math.max(Number(input.required_consensus) || 3, 1), 21);
  const owner_id = String(input.owner_id || 'owner').slice(0, 128);
  const now = new Date().toISOString();

  const s = load();
  const existing = s.sacred[object_id];
  if (existing && existing.status === 'sacred') {
    return {
      ok: false,
      error: 'already_sacred',
      object: existing,
      protocol: 'SPB/1',
    };
  }

  const obj: SacredObject = {
    object_id,
    label: String(input.label || object_id).slice(0, 200),
    content_hash,
    owner_id,
    required_consensus: required,
    consensus_holders: [owner_id],
    reason: input.reason ? String(input.reason).slice(0, 500) : undefined,
    enshrined_at: now,
    provenance: [
      {
        at: now,
        type: 'enshrine',
        actor_id: owner_id,
        detail: `Enshrined hash=${content_hash.slice(0, 16)}… consensus=${required}`,
      },
    ],
    status: 'sacred',
  };
  s.sacred[object_id] = obj;
  save(s);
  return {
    ok: true,
    object: obj,
    audit_id: randomUUID(),
    protocol: 'SPB/1',
    note: 'Mutation requires multi-agent consensus; routine MCP tools must call sacred/verify first.',
  };
}

export function sacredVerify(objectId: string): Record<string, unknown> {
  const object_id = String(objectId || '').trim().slice(0, 128);
  const s = load();
  const obj = s.sacred[object_id];
  if (!obj) {
    return {
      object_id,
      status: 'not_found',
      sacred: false,
      protocol: 'SPB/1',
    };
  }
  const verifyProvenance: ProvenanceEvent[] = [
    {
      at: new Date().toISOString(),
      type: 'verify',
      actor_id: 'verifier',
      detail: 'verify_read',
    },
    ...obj.provenance,
  ];
  obj.provenance = verifyProvenance.slice(0, 100);
  s.sacred[object_id] = obj;
  save(s);
  const hash_ok = /^[a-fA-F0-9]{16,128}$/.test(obj.content_hash) || obj.content_hash.length >= 8;
  return {
    object_id,
    sacred: obj.status === 'sacred',
    status: obj.status,
    content_hash: obj.content_hash,
    hash_format_ok: hash_ok,
    required_consensus: obj.required_consensus,
    consensus_holders: obj.consensus_holders,
    consensus_met: obj.consensus_holders.length >= obj.required_consensus,
    provenance: obj.provenance.slice(0, 20),
    protocol: 'SPB/1',
  };
}

export function profaneDiscard(input: {
  object_id: string;
  retention_policy?: 'drop' | 'soft_delete' | 'ttl';
  ttl_seconds?: number;
  reason?: string;
  actor_id?: string;
  payer?: string;
}): Record<string, unknown> {
  const object_id = String(input.object_id || '').trim().slice(0, 128);
  if (!object_id) throw new Error('object_id_required');
  const s = load();
  const sacred = s.sacred[object_id];
  if (sacred && sacred.status === 'sacred') {
    const discardBlockedProvenance: ProvenanceEvent[] = [
      {
        at: new Date().toISOString(),
        type: 'discard_blocked',
        actor_id: String(input.actor_id || 'actor').slice(0, 128),
        detail: 'profane discard refused — object is sacred',
      },
      ...sacred.provenance,
    ];
    sacred.provenance = discardBlockedProvenance.slice(0, 100);
    s.sacred[object_id] = sacred;
    save(s);
    return {
      ok: false,
      error: 'sacred_protected',
      object_id,
      required_consensus: sacred.required_consensus,
      message: 'Object is sacred. Obtain multi-agent consensus before mutation.',
      protocol: 'SPB/1',
    };
  }

  const rec: ProfaneRecord = {
    object_id,
    retention_policy: input.retention_policy || 'drop',
    ttl_seconds: input.ttl_seconds,
    reason: input.reason ? String(input.reason).slice(0, 500) : undefined,
    actor_id: String(input.actor_id || 'actor').slice(0, 128),
    discarded_at: new Date().toISOString(),
  };
  s.profane = [rec, ...s.profane].slice(0, 500);
  save(s);
  return {
    ok: true,
    discarded: rec,
    content_fingerprint: createHash('sha256').update(object_id).digest('hex').slice(0, 16),
    protocol: 'SPB/1',
  };
}
