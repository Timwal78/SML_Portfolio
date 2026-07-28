import { createHash } from 'crypto';
import { EchonetStore, addUnits, type GraphEdge, type AgentNode } from './store.js';
import { isSelfWallet, normalizeAddr, payToIdentity, taskTypeFromResource } from './identity.js';

export interface SettleEvent {
  payer: string;
  resource: string;
  units: string;
  tx: string;
  rail: string;
}

function emptyAgent(address: string, self: boolean): AgentNode {
  return {
    address,
    settlesOut: 0,
    settlesIn: 0,
    volumeOutUnits: '0',
    volumeInUnits: '0',
    uniqueCounterparties: 0,
    lastSeen: new Date().toISOString(),
    reputation: self ? 0 : 1,
    self,
  };
}

function touchAgent(
  agents: Record<string, AgentNode>,
  address: string,
  side: 'out' | 'in',
  units: string,
  counterparty: string,
): void {
  const a = normalizeAddr(address);
  if (!a.startsWith('0x')) return;
  const self = isSelfWallet(a);
  if (!agents[a]) agents[a] = emptyAgent(a, self);
  const node = agents[a]!;
  node.lastSeen = new Date().toISOString();
  node.self = self;
  if (side === 'out') {
    node.settlesOut += 1;
    node.volumeOutUnits = addUnits(node.volumeOutUnits, units);
  } else {
    node.settlesIn += 1;
    node.volumeInUnits = addUnits(node.volumeInUnits, units);
  }
  // reputation: stranger volume + unique counterparties (not self loops)
  if (!self && !isSelfWallet(counterparty)) {
    node.reputation = Math.min(
      100000,
      node.reputation + 1 + Math.min(10, Number(BigInt(units) / 1000n)),
    );
  }
}

export function recordSettle(ev: SettleEvent): { edge: GraphEdge; stranger: boolean } {
  const store = EchonetStore.getInstance();
  const from = normalizeAddr(ev.payer);
  const to = payToIdentity();
  const self = isSelfWallet(from);
  const edge: GraphEdge = {
    id: createHash('sha256').update(`${ev.tx}:${ev.resource}:${Date.now()}`).digest('hex').slice(0, 16),
    from,
    to,
    resource: ev.resource,
    units: ev.units || '1000',
    tx: ev.tx || '',
    rail: ev.rail || 'unknown',
    taskType: taskTypeFromResource(ev.resource),
    ts: new Date().toISOString(),
    self,
  };

  store.mutate((s) => {
    s.edges.push(edge);
    if (self) s.stats.selfSettles += 1;
    else s.stats.strangerSettles += 1;
    touchAgent(s.agents, from, 'out', edge.units, to);
    touchAgent(s.agents, to, 'in', edge.units, from);
    // unique counterparties recount light
    for (const addr of [from, to]) {
      const node = s.agents[addr];
      if (!node) continue;
      const cps = new Set<string>();
      for (const e of s.edges) {
        if (e.self) continue;
        if (e.from === addr) cps.add(e.to);
        if (e.to === addr) cps.add(e.from);
      }
      node.uniqueCounterparties = cps.size;
    }
  });

  return { edge, stranger: !self };
}

export function queryGraph(opts: {
  taskType?: string;
  minRep?: number;
  limit?: number;
}): {
  ranking: Array<{ address: string; reputation: number; settlesOut: number; volumeOutUnits: string; taskHits: number }>;
  hotResources: Array<{ resource: string; strangerSettles: number; volumeUnits: string }>;
  edgesSample: GraphEdge[];
} {
  const s = EchonetStore.getInstance().getState();
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 50));
  const minRep = opts.minRep ?? 0;
  const task = (opts.taskType || '').toLowerCase();

  const resourceHits = new Map<string, { n: number; vol: bigint }>();
  for (const e of s.edges) {
    if (e.self) continue;
    if (task && e.taskType.toLowerCase() !== task && !e.resource.toLowerCase().includes(task)) continue;
    const cur = resourceHits.get(e.resource) || { n: 0, vol: 0n };
    cur.n += 1;
    cur.vol += BigInt(e.units || '0');
    resourceHits.set(e.resource, cur);
  }

  const taskHitsByAgent = new Map<string, number>();
  for (const e of s.edges) {
    if (e.self) continue;
    if (task && e.taskType.toLowerCase() !== task && !e.resource.toLowerCase().includes(task)) continue;
    taskHitsByAgent.set(e.from, (taskHitsByAgent.get(e.from) || 0) + 1);
  }

  const ranking = Object.values(s.agents)
    .filter((a) => !a.self && a.reputation >= minRep)
    .map((a) => ({
      address: a.address,
      reputation: a.reputation,
      settlesOut: a.settlesOut,
      volumeOutUnits: a.volumeOutUnits,
      taskHits: taskHitsByAgent.get(a.address) || 0,
    }))
    .sort((a, b) => b.reputation - a.reputation || b.taskHits - a.taskHits)
    .slice(0, limit);

  const hotResources = [...resourceHits.entries()]
    .map(([resource, v]) => ({ resource, strangerSettles: v.n, volumeUnits: v.vol.toString() }))
    .sort((a, b) => b.strangerSettles - a.strangerSettles)
    .slice(0, limit);

  const edgesSample = s.edges.filter((e) => !e.self).slice(-limit).reverse();

  return { ranking, hotResources, edgesSample };
}

export function agentProfile(address: string): AgentNode | null {
  const a = normalizeAddr(address);
  return EchonetStore.getInstance().getState().agents[a] || null;
}
