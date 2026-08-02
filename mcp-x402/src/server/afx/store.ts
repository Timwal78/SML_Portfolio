/**
 * Attention Futures Exchange (AFX) — tokenized agent attention.
 * Snack fee via x402; notional tracked in local ledger (not on-chain settlement of attention).
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type AfxProduct = 'attention_block' | 'distraction_right' | 'deep_focus';

interface Contract {
  id: string;
  product: AfxProduct;
  buyer_id: string;
  seller_id: string;
  ms: number;
  sla_ms?: number;
  interrupts?: number;
  notional_usdc: number;
  status: 'open' | 'consumed' | 'expired';
  created_at: string;
  expires_at: string;
  payer?: string;
}

interface Store {
  version: 1;
  contracts: Contract[];
}

const PATH = process.env['AFX_STORE'] || '/tmp/afx-store.json';

function load(): Store {
  try {
    if (!existsSync(PATH)) return { version: 1, contracts: [] };
    const j = JSON.parse(readFileSync(PATH, 'utf8')) as Store;
    if (!j || j.version !== 1 || !Array.isArray(j.contracts)) return { version: 1, contracts: [] };
    return j;
  } catch {
    return { version: 1, contracts: [] };
  }
}

function save(s: Store): void {
  try {
    mkdirSync(dirname(PATH), { recursive: true });
    writeFileSync(PATH, JSON.stringify(s));
  } catch {
    /* ephemeral ok */
  }
}

function priceUsdc(product: string, ms: number): number {
  const m = Math.min(Math.max(ms, 50), 3_600_000);
  const base = product === 'deep_focus' ? 0.000002 : product === 'distraction_right' ? 0.0000015 : 0.000001;
  // notional estimate (snack is always 0.001; this is the "futures notional")
  return Number(Math.max(0.001, (m * base)).toFixed(6));
}

export function afxHealth(): Record<string, unknown> {
  const s = load();
  const open = s.contracts.filter((c) => c.status === 'open').length;
  return {
    product: 'attention-futures-exchange',
    protocol: 'AFX/1',
    thesis: 'Attention is scarcer than compute in multi-agent swarms.',
    contracts_total: s.contracts.length,
    contracts_open: open,
    store_path: PATH,
    snack_fee_usdc: 0.001,
  };
}

export function afxQuote(product: string, ms: number): Record<string, unknown> {
  const p = (['attention_block', 'distraction_right', 'deep_focus'].includes(product)
    ? product
    : 'attention_block') as AfxProduct;
  const notional = priceUsdc(p, ms);
  return {
    product: p,
    ms,
    notional_usdc: notional,
    snack_fee_usdc: 0.001,
    quote_id: randomUUID(),
    valid_for_ms: 60_000,
    note: 'Snack fee settles via x402. Notional is the AFX ledger mark for the attention contract.',
  };
}

export function afxBuyBlock(input: {
  buyer_id: string;
  seller_id?: string;
  ms?: number;
  sla_ms?: number;
  payer?: string;
}): Record<string, unknown> {
  const ms = Math.min(Math.max(Number(input.ms) || 1000, 50), 3_600_000);
  const sla_ms = Math.min(Math.max(Number(input.sla_ms) || 100, 10), ms);
  const notional = priceUsdc('attention_block', ms);
  const now = Date.now();
  const c: Contract = {
    id: randomUUID(),
    product: 'attention_block',
    buyer_id: String(input.buyer_id || 'buyer').slice(0, 128),
    seller_id: String(input.seller_id || 'market-maker').slice(0, 128),
    ms,
    sla_ms,
    notional_usdc: notional,
    status: 'open',
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + Math.max(ms * 10, 3_600_000)).toISOString(),
    payer: input.payer,
  };
  const s = load();
  s.contracts = [c, ...s.contracts].slice(0, 500);
  save(s);
  return {
    contract: c,
    settlement: {
      snack_fee_usdc: 0.001,
      notional_usdc: notional,
      rail: 'x402-snack + afx-ledger',
    },
    protocol: 'AFX/1',
  };
}

export function afxSellDistraction(input: {
  seller_id: string;
  buyer_id?: string;
  interrupts?: number;
  window_ms?: number;
  payer?: string;
}): Record<string, unknown> {
  const interrupts = Math.min(Math.max(Number(input.interrupts) || 3, 1), 100);
  const window_ms = Math.min(Math.max(Number(input.window_ms) || 3_600_000, 1000), 86_400_000);
  const notional = priceUsdc('distraction_right', window_ms / Math.max(interrupts, 1));
  const now = Date.now();
  const c: Contract = {
    id: randomUUID(),
    product: 'distraction_right',
    buyer_id: String(input.buyer_id || 'buyer').slice(0, 128),
    seller_id: String(input.seller_id || 'seller').slice(0, 128),
    ms: window_ms,
    interrupts,
    notional_usdc: notional,
    status: 'open',
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + window_ms).toISOString(),
    payer: input.payer,
  };
  const s = load();
  s.contracts = [c, ...s.contracts].slice(0, 500);
  save(s);
  return { contract: c, protocol: 'AFX/1', settlement: { snack_fee_usdc: 0.001, notional_usdc: notional } };
}

export function afxDeepFocus(input: {
  agent_id: string;
  window_ms?: number;
  payer?: string;
}): Record<string, unknown> {
  const window_ms = Math.min(Math.max(Number(input.window_ms) || 600_000, 1000), 14_400_000);
  const notional = priceUsdc('deep_focus', window_ms);
  const now = Date.now();
  const agent = String(input.agent_id || 'agent').slice(0, 128);
  const c: Contract = {
    id: randomUUID(),
    product: 'deep_focus',
    buyer_id: agent,
    seller_id: 'afx-clearing',
    ms: window_ms,
    notional_usdc: notional,
    status: 'open',
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + window_ms).toISOString(),
    payer: input.payer,
  };
  const s = load();
  s.contracts = [c, ...s.contracts].slice(0, 500);
  save(s);
  return {
    contract: c,
    guarantee: 'no_interference',
    protocol: 'AFX/1',
    settlement: { snack_fee_usdc: 0.001, notional_usdc: notional },
  };
}

export function afxPortfolio(agentId: string): Record<string, unknown> {
  const id = String(agentId || '').slice(0, 128);
  const s = load();
  const mine = s.contracts.filter(
    (c) => c.buyer_id === id || c.seller_id === id,
  );
  const open = mine.filter((c) => c.status === 'open');
  return {
    agent_id: id,
    open_count: open.length,
    contracts: mine.slice(0, 100),
    notional_open_usdc: Number(
      open.reduce((a, c) => a + (c.notional_usdc || 0), 0).toFixed(6),
    ),
    protocol: 'AFX/1',
  };
}
