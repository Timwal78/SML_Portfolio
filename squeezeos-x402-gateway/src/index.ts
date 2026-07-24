#!/usr/bin/env node
/**
 * SqueezeOS x402 Gateway — the TENT
 * 3 tools: collect_payment | prove_creditworthiness | generate_compliance_log
 * Positioning: the AGENT is the business (wallet, credit, compliance) — not the human.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const PROOF402_URL = process.env['PROOF402_URL'] ?? process.env['PROOF402_SERVER_URL'] ?? 'https://four02proof.onrender.com';
const PAY_TO = process.env['PAY_TO'] ?? process.env['X402_PAY_TO'] ?? '0x72330994f379a71542e7bd5a4cf99a9d9743f4aa';
const HMAC_SECRET = process.env['COMPLIANCE_HMAC_SECRET'] ?? 'sml-dev-compliance-secret-change-me';
const DATA_DIR = process.env['AGENT_BUSINESS_DATA'] ?? join(process.cwd(), 'data');
const LEDGER_PATH = join(DATA_DIR, 'agent-ledger.jsonl');
const WALLET_PATH = join(DATA_DIR, 'agent-wallet.json');

type LedgerEntry = {
  id: string;
  ts: string;
  type: 'payment' | 'credit_check' | 'compliance_export';
  agent_wallet: string;
  amount?: string;
  currency?: string;
  chain?: string;
  counterparty?: string;
  memo?: string;
  external_ref?: string;
  status: string;
  hmac: string;
};

function ensureData(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(LEDGER_PATH)) writeFileSync(LEDGER_PATH, '', 'utf8');
}

function loadOrCreateWallet(): { agent_wallet: string; created_at: string; label: string } {
  ensureData();
  if (process.env['AGENT_WALLET']) {
    return {
      agent_wallet: process.env['AGENT_WALLET'],
      created_at: new Date().toISOString(),
      label: 'env',
    };
  }
  if (existsSync(WALLET_PATH)) {
    return JSON.parse(readFileSync(WALLET_PATH, 'utf8')) as {
      agent_wallet: string;
      created_at: string;
      label: string;
    };
  }
  const agent_wallet = `agent_${createHash('sha256').update(randomUUID()).digest('hex').slice(0, 32)}`;
  const rec = {
    agent_wallet,
    created_at: new Date().toISOString(),
    label: 'local-agent-business',
    pay_to_hint: PAY_TO,
    note: 'Agent-held business identity. Replace AGENT_WALLET with on-chain address in production.',
  };
  writeFileSync(WALLET_PATH, JSON.stringify(rec, null, 2));
  return rec;
}

function signEntry(body: Omit<LedgerEntry, 'hmac'>): string {
  return createHmac('sha256', HMAC_SECRET).update(JSON.stringify(body)).digest('hex');
}

function appendLedger(entry: Omit<LedgerEntry, 'hmac'>): LedgerEntry {
  ensureData();
  const hmac = signEntry(entry);
  const full: LedgerEntry = { ...entry, hmac };
  appendFileSync(LEDGER_PATH, JSON.stringify(full) + '\n', 'utf8');
  return full;
}

function readLedger(): LedgerEntry[] {
  ensureData();
  const raw = readFileSync(LEDGER_PATH, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as LedgerEntry);
}

function textResult(obj: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }],
    isError,
  };
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'squeezeos-x402-gateway/1.0.0',
        ...(init?.headers || {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    const txt = await res.text();
    let body: unknown = txt;
    try {
      body = JSON.parse(txt);
    } catch {
      /* keep text */
    }
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: { error: String(e) } };
  }
}

async function proveCredit(wallet: string): Promise<Record<string, unknown>> {
  // Try live 402Proof paths, then deterministic local score from ledger
  const paths = [`/v1/credit/${encodeURIComponent(wallet)}`, `/v1/bureau/score/${encodeURIComponent(wallet)}`];
  for (const p of paths) {
    const r = await fetchJson(`${PROOF402_URL}${p}`);
    if (r.ok && r.body && typeof r.body === 'object') {
      return {
        source: '402proof',
        endpoint: p,
        agent_wallet: wallet,
        ...(r.body as object),
      };
    }
  }

  const ledger = readLedger();
  const pays = ledger.filter((e) => e.type === 'payment' && e.status === 'recorded');
  const base = 320;
  const score = Math.min(850, base + pays.length * 12 + Math.min(80, ledger.length * 3));
  const band = score >= 700 ? 'excellent' : score >= 580 ? 'fair' : score >= 400 ? 'building' : 'thin_file';
  return {
    source: 'local_attestation',
    agent_wallet: wallet,
    score,
    band,
    scale: '300-850',
    payments_recorded: pays.length,
    ledger_events: ledger.length,
    attestation: {
      statement: 'Agent business thin-file score from signed local ledger until bureau populates.',
      merchant_question: 'will_this_bot_pay',
      recommendation: score >= 500 ? 'allow_micro' : 'require_prepay_or_limit',
    },
    proof402_status: 'fallback_local',
  };
}

async function collectPayment(input: {
  amount: string;
  currency: string;
  chain: string;
  memo?: string;
  counterparty?: string;
  x_payment?: string;
}): Promise<Record<string, unknown>> {
  const wallet = loadOrCreateWallet();
  // Attempt facilitator; always record compliance trail for the agent business
  const payAttempt = await fetchJson(`${PROOF402_URL}/v1/pay`, {
    method: 'POST',
    body: JSON.stringify({
      amount: input.amount,
      currency: input.currency,
      chain: input.chain,
      wallet: wallet.agent_wallet,
      pay_to: PAY_TO,
      memo: input.memo,
      x_payment: input.x_payment,
    }),
  });

  const external_ref =
    (payAttempt.body as { receipt_id?: string; tx_hash?: string } | undefined)?.receipt_id ||
    (payAttempt.body as { tx_hash?: string } | undefined)?.tx_hash ||
    (input.x_payment ? createHash('sha256').update(input.x_payment).digest('hex').slice(0, 16) : undefined);

  const status = payAttempt.ok ? 'settled_or_accepted' : input.x_payment ? 'payment_header_recorded' : 'challenge_or_pending';

  const entry = appendLedger({
    id: randomUUID(),
    ts: new Date().toISOString(),
    type: 'payment',
    agent_wallet: wallet.agent_wallet,
    amount: input.amount,
    currency: input.currency,
    chain: input.chain,
    counterparty: input.counterparty ?? PAY_TO,
    memo: input.memo ?? 'collect_payment',
    external_ref,
    status,
  });

  // x402-style challenge when no payment presented and facilitator didn't settle
  const challenge =
    !payAttempt.ok && !input.x_payment
      ? {
          http_status_hint: 402,
          accept: {
            amount: input.amount,
            currency: input.currency,
            chain: input.chain,
            pay_to: PAY_TO,
            description: 'Agent business payment — attach X-PAYMENT / x_payment and retry',
          },
          facilitator: PROOF402_URL,
        }
      : undefined;

  return {
    ok: payAttempt.ok || Boolean(input.x_payment),
    message:
      'Payment path executed for the AGENT business entity (not a human merchant account). Compliance event signed.',
    agent_wallet: wallet.agent_wallet,
    ledger_entry: entry,
    facilitator: { status: payAttempt.status, body: payAttempt.body },
    challenge,
    next: challenge
      ? 'Retry collect_payment with x_payment after client settles x402.'
      : 'Call prove_creditworthiness or generate_compliance_log as needed.',
  };
}

function generateComplianceLog(input: { format?: string; since?: string }): Record<string, unknown> {
  const wallet = loadOrCreateWallet();
  let entries = readLedger();
  if (input.since) {
    const t = Date.parse(input.since);
    if (!Number.isNaN(t)) entries = entries.filter((e) => Date.parse(e.ts) >= t);
  }

  // verify HMACs
  let valid = 0;
  let invalid = 0;
  for (const e of entries) {
    const { hmac, ...rest } = e;
    const expect = signEntry(rest);
    if (expect === hmac) valid++;
    else invalid++;
  }

  const export_id = randomUUID();
  const payload = {
    export_id,
    generated_at: new Date().toISOString(),
    product: 'squeezeos-x402-gateway',
    positioning: 'AI agent is the business — wallet, credit, compliance without human merchant account',
    sdvosb: {
      uei: 'G24VZA4RLMK3',
      cage: '21U51',
      concern: 'Script Master Labs, LLC',
      note: 'Service-Disabled Veteran-Owned Small Business',
    },
    agent_wallet: wallet.agent_wallet,
    entry_count: entries.length,
    hmac_valid: valid,
    hmac_invalid: invalid,
    algorithm: 'HMAC-SHA256',
    entries,
  };

  const export_hmac = createHmac('sha256', HMAC_SECRET).update(JSON.stringify(payload)).digest('hex');
  appendLedger({
    id: randomUUID(),
    ts: new Date().toISOString(),
    type: 'compliance_export',
    agent_wallet: wallet.agent_wallet,
    memo: `export:${export_id}`,
    external_ref: export_hmac.slice(0, 16),
    status: 'exported',
  });

  return {
    ...payload,
    export_hmac,
    procurement_language:
      'Signed agent spend audit trail suitable for pilot procurement packages, SDVOSB capability attachments, and enterprise autonomous-spend control reviews.',
  };
}

async function main(): Promise<void> {
  ensureData();
  const wallet = loadOrCreateWallet();

  const server = new McpServer({
    name: 'squeezeos-x402-gateway',
    version: '1.0.0',
  });

  server.tool(
    'collect_payment',
    'Agent business collects/sends payment before work. Agent wallet — no human merchant account. Records HMAC compliance event.',
    {
      amount: z.string().describe('Amount e.g. 0.01'),
      currency: z.enum(['USDC', 'RLUSD']).default('USDC'),
      chain: z.enum(['base', 'xrpl', 'solana']).default('base'),
      memo: z.string().optional(),
      counterparty: z.string().optional(),
      x_payment: z.string().optional().describe('Optional settled payment header/proof from client'),
    },
    async (args) => {
      const result = await collectPayment({
        amount: args.amount,
        currency: args.currency ?? 'USDC',
        chain: args.chain ?? 'base',
        memo: args.memo,
        counterparty: args.counterparty,
        x_payment: args.x_payment,
      });
      return textResult(result, !result.ok && !args.x_payment);
    },
  );

  server.tool(
    'prove_creditworthiness',
    'Returns agent credit score + attestation graph answer to: will this bot pay?',
    {
      wallet: z.string().optional().describe('Defaults to this agent business wallet'),
    },
    async (args) => {
      const w = args.wallet || loadOrCreateWallet().agent_wallet;
      const credit = await proveCredit(w);
      appendLedger({
        id: randomUUID(),
        ts: new Date().toISOString(),
        type: 'credit_check',
        agent_wallet: w,
        memo: 'prove_creditworthiness',
        status: 'checked',
        external_ref: String((credit as { score?: number }).score ?? 'n/a'),
      });
      return textResult({
        merchant_question: 'will_this_bot_pay',
        agent_wallet: w,
        credit,
        sdvosb_operator: { uei: 'G24VZA4RLMK3', cage: '21U51' },
      });
    },
  );

  server.tool(
    'generate_compliance_log',
    'Export HMAC-signed audit trail of agent transactions for government/enterprise procurement.',
    {
      since: z.string().optional().describe('ISO timestamp filter'),
      format: z.enum(['json']).default('json'),
    },
    async (args) => textResult(generateComplianceLog({ since: args.since, format: args.format })),
  );

  // tiny discover for hosts that list tools only — still only 3 core tools above
  server.tool(
    'agent_business_status',
    'Free status: agent wallet id + ledger counts + positioning one-liner.',
    {},
    async () => {
      const w = loadOrCreateWallet();
      const ledger = readLedger();
      return textResult({
        slogan: 'Your AI agent is a business. It just does not have a bank account.',
        agent_wallet: w.agent_wallet,
        ledger_events: ledger.length,
        tools: ['collect_payment', 'prove_creditworthiness', 'generate_compliance_log'],
        landing: 'https://www.scriptmasterlabs.com/agent-wallet',
        sdvosb: { uei: 'G24VZA4RLMK3', cage: '21U51' },
        pay_to_hint: PAY_TO,
      });
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[squeezeos-x402-gateway] agent business online wallet=${wallet.agent_wallet}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
