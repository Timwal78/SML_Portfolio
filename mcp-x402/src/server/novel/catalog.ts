/**
 * Novel Agent Infrastructure Package — 14 negative-space APIs.
 * Brand: "Physiology & Boundary Rails for Agents"
 * Live snacks settle via x402 dual-rail (Base USDC + Robinhood USDG).
 */
export type NovelStatus = 'live' | 'preview' | 'roadmap';

export interface NovelConcept {
  id: number;
  slug: string;
  name: string;
  short: string;
  thesis: string;
  status: NovelStatus;
  routes: string[];
  price_usdc: number;
  tags: string[];
}

export const NOVEL_PACKAGE = {
  id: 'sml-novel-agent-infra',
  name: 'ScriptMasterLabs Novel Agent Infrastructure',
  codename: 'NEGATIVE_SPACE_14',
  version: '1.0.0',
  tagline: 'Truth, survival, and meaning — not just efficiency.',
  thesis:
    'The industry optimizes for predictability and scale. This package optimizes for agent physiology, attention markets, and ontological boundaries.',
  operator: 'Script Master Labs, LLC (SDVOSB)',
  settlement: {
    protocol: 'x402',
    snack_usdc: 0.001,
    rails: ['base-usdc eip155:8453', 'robinhood-usdg eip155:4663'],
    payTo_note: 'SML_PAYMENT_RECEIVER (ACP agent wallet)',
  },
  homepage: 'https://www.scriptmasterlabs.com',
  host: 'https://mcp-x402.onrender.com',
} as const;

export const NOVEL_CONCEPTS: NovelConcept[] = [
  {
    id: 1,
    slug: 'sleep-mcp',
    name: 'Agent Somnambulism Protocol (Sleep MCP)',
    short: 'Consolidation cycles, dreams, nightmares, zombie-context GC',
    thesis: 'Agents need sleep — generalization happens offline.',
    status: 'live',
    routes: [
      'GET /x402/sleep/health',
      'POST /x402/sleep/cycle',
      'GET /x402/sleep/dreams',
      'POST /x402/sleep/nightmare',
    ],
    price_usdc: 0.001,
    tags: ['physiology', 'memory', 'ASP'],
  },
  {
    id: 2,
    slug: 'entropy-as-a-service',
    name: 'Entropy-as-a-Service (EaaS)',
    short: 'Calibrated noise into tool sequences and negotiations',
    thesis: 'Anti-fragility requires structured disorder.',
    status: 'roadmap',
    routes: ['POST /x402/novel/entropy/inject (soon)'],
    price_usdc: 0.001,
    tags: ['chaos', 'security', 'creativity'],
  },
  {
    id: 3,
    slug: 'regret-minimization',
    name: 'Regret Minimization Protocol (RMP)',
    short: 'Hindsight ledger + minimax regret before high-stakes acts',
    thesis: 'Minimize regret, do not only maximize expected reward.',
    status: 'roadmap',
    routes: ['POST /x402/novel/regret/check (soon)'],
    price_usdc: 0.001,
    tags: ['decision', 'counterfactual'],
  },
  {
    id: 4,
    slug: 'synchronicity-engine',
    name: 'Synchronicity Engine API',
    short: 'Cross-domain low-probability correlation events',
    thesis: 'Meaningful coincidence is competitive signal.',
    status: 'roadmap',
    routes: ['POST /x402/novel/sync/watch (soon)'],
    price_usdc: 0.001,
    tags: ['patterns', 'multi-agent'],
  },
  {
    id: 5,
    slug: 'digital-thanatology',
    name: 'Digital Thanatology / Death MCP',
    short: 'Living wills, memory bequest, ghost mode, probate',
    thesis: 'Agents need end-of-life infrastructure.',
    status: 'roadmap',
    routes: ['GET /x402/novel/thanatos/alive (soon)'],
    price_usdc: 0.001,
    tags: ['lifecycle', 'legacy'],
  },
  {
    id: 6,
    slug: 'cognitive-friction',
    name: 'Cognitive Friction API',
    short: 'Deliberation rituals and cooling windows for high stakes',
    thesis: 'Frictionless UX kills deliberation.',
    status: 'live',
    routes: [
      'GET /x402/friction/health',
      'POST /x402/friction/apply',
      'POST /x402/friction/explain',
      'GET /x402/friction/status',
      'POST /x402/friction/confirm',
    ],
    price_usdc: 0.001,
    tags: ['safety', 'ritual'],
  },
  {
    id: 7,
    slug: 'taboo-surface',
    name: 'Taboo Surface API',
    short: 'Combinatorial safety across tool-output geometry',
    thesis: 'Harm emerges from combinations, not single inputs.',
    status: 'roadmap',
    routes: ['POST /x402/novel/taboo/check (soon)'],
    price_usdc: 0.001,
    tags: ['security', 'combinatorial'],
  },
  {
    id: 8,
    slug: 'unlearning',
    name: 'Unlearning-as-a-Service',
    short: 'Surgical amnesia without full retrain',
    thesis: 'Infinite training APIs; zero unlearning APIs.',
    status: 'roadmap',
    routes: ['POST /x402/novel/unlearn (soon)'],
    price_usdc: 0.001,
    tags: ['memory', 'privacy'],
  },
  {
    id: 9,
    slug: 'afx',
    name: 'Attention Futures Exchange (AFX)',
    short: 'Buy attention blocks, sell distraction rights, deep focus',
    thesis: 'Attention is scarcer than compute in swarms.',
    status: 'live',
    routes: [
      'GET /x402/afx/health',
      'GET /x402/afx/quote',
      'POST /x402/afx/buy-block',
      'POST /x402/afx/sell-distraction',
      'POST /x402/afx/deep-focus',
      'GET /x402/afx/portfolio',
    ],
    price_usdc: 0.001,
    tags: ['markets', 'attention', 'x402'],
  },
  {
    id: 10,
    slug: 'narrative-coherence',
    name: 'Narrative Coherence Protocol (NCP)',
    short: 'Story-shaped multi-agent outcomes humans can audit',
    thesis: 'Humans judge by story, not only utility.',
    status: 'roadmap',
    routes: ['POST /x402/novel/narrative/check (soon)'],
    price_usdc: 0.001,
    tags: ['audit', 'story'],
  },
  {
    id: 11,
    slug: 'shadow-self',
    name: 'Shadow Self MCP',
    short: 'Ledger of rejected paths and suppressed biases',
    thesis: 'The shadow is diagnostic gold.',
    status: 'roadmap',
    routes: ['POST /x402/novel/shadow/integrate (soon)'],
    price_usdc: 0.001,
    tags: ['diagnostics', 'bias'],
  },
  {
    id: 12,
    slug: 'phase-transition',
    name: 'Phase Transition API',
    short: 'Predict swarm snaps: cooperative → chaotic',
    thesis: 'Complex systems snap; they do not only drift.',
    status: 'roadmap',
    routes: ['GET /x402/novel/phase/state (soon)'],
    price_usdc: 0.001,
    tags: ['swarm', 'stability'],
  },
  {
    id: 13,
    slug: 'mimicry',
    name: 'Mimicry / Camouflage API',
    short: 'Adopt foreign agent fingerprints for red-team/privacy',
    thesis: 'Mimicry is survival and security primitive.',
    status: 'roadmap',
    routes: ['POST /x402/novel/mimicry/wrap (soon)'],
    price_usdc: 0.001,
    tags: ['security', 'testing'],
  },
  {
    id: 14,
    slug: 'sacred-profane',
    name: 'Sacred / Profane Boundary',
    short: 'Enshrine immutable objects; discard disposable ones',
    thesis: 'Not all data is equally mutable.',
    status: 'live',
    routes: [
      'GET /x402/sacred/health',
      'POST /x402/sacred/enshrine',
      'GET /x402/sacred/verify',
      'POST /x402/profane/discard',
    ],
    price_usdc: 0.001,
    tags: ['governance', 'ontology'],
  },
];

export function novelCatalog() {
  const live = NOVEL_CONCEPTS.filter((c) => c.status === 'live');
  const roadmap = NOVEL_CONCEPTS.filter((c) => c.status === 'roadmap');
  return {
    package: NOVEL_PACKAGE,
    counts: {
      total: NOVEL_CONCEPTS.length,
      live: live.length,
      roadmap: roadmap.length,
    },
    live: live.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      routes: c.routes,
      price_usdc: c.price_usdc,
    })),
    roadmap: roadmap.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      short: c.short,
    })),
    concepts: NOVEL_CONCEPTS,
    how_to_buy: {
      snack: 'Pay 0.001 USDC on Base or USDG on Robinhood Chain, retry with X-PAYMENT or X-PAYMENT-TX',
      operator: 'Server-only X-Operator-Key = SML_API_KEY (never browser)',
      bundle: 'POST /x402/novel/bundle — one payment, physiology snapshot across live trio',
    },
  };
}

export function novelManifest() {
  return {
    ...NOVEL_PACKAGE,
    concepts: NOVEL_CONCEPTS.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      status: c.status,
      routes: c.routes,
    })),
    openapi: 'https://mcp-x402.onrender.com/.well-known/x402',
    llms: 'https://mcp-x402.onrender.com/llms.txt',
    agent402: 'https://agent402.tools/api/route?q=scriptmaster+sleep+afx+sacred',
  };
}
