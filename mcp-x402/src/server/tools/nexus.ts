import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { SqueezeOSAPI } from '../../lib/sml-api/squeezeos.js';

const VALID_JOB_TYPES = new Set(['ANALYSIS', 'SCAN', 'SIGNAL', 'PREDICTION', 'ARBITRAGE', 'RESEARCH', 'DATA', 'CUSTOM']);

const InputSchema = z.object({
  capability: z.string().min(1).max(200),
  max_budget: z.string().regex(/^\d+(\.\d+)?$/),
  chain_preference: z.enum(['base', 'xrpl', 'solana']).optional(),
  action: z.enum(['query', 'hire']).default('query'),
  symbol: z.string().optional(),
  xrpl_wallet: z.string().optional(),
  agent_id: z.string().optional(),
  wallet_address: z.string().optional(),
  payment_tx_hash: z.string().optional(),
  payment_header: z.string().optional(),
});

const COMMISSION_RATE = 0.05;

interface HiringJob {
  job_type: string;
  description: string;
  [key: string]: unknown;
}

export function registerNexus(server: McpServer): void {
  server.tool(
    'nexus_agent_hire',
    {
      capability: z.string().describe('Capability or skill to search for (e.g. "options flow analysis").'),
      max_budget: z.string().describe('Max budget in RLUSD for the job bounty (e.g. "1.00"). Also used to compute the 5% USDC commission on hire.'),
      chain_preference: z.enum(['base', 'xrpl', 'solana']).describe('Payment chain for the mcp-x402 commission fee. The job bounty itself always settles wallet-to-wallet on XRPL — SqueezeOS\'s real Agent Hiring Protocol board is zero-custody and XRPL-native.'),
      action: z.enum(['query', 'hire']).describe('"query" is free (browses SqueezeOS\'s real live job board). "hire" posts a real job there and charges 5% commission on the bounty.'),
      symbol: z.string().optional().describe('Optional ticker to filter/tag the job by.'),
      xrpl_wallet: z.string().describe('Your XRPL wallet (starts with "r"). Required for action=hire — SqueezeOS\'s job board is zero-custody and pays the bounty to/from real XRPL wallets, not this gateway\'s USDC wallet.'),
      agent_id: z.string().describe('Optional free-text note on who you want to do the work — the real board is an open marketplace (any qualified executor can accept), not a directed hire of one specific agent, so this is folded into the job\'s requirements text rather than targeting an agent_id.'),
      wallet_address: z.string().describe('Agent wallet for the mcp-x402 commission payment (Base/USDC).'),
      payment_tx_hash: z.string().optional().describe('On-chain Base tx hash proving USDC payment to the operator (sovereign rail). Omit if using payment_header.'),
      payment_header: z.string().optional().describe('Base64 X-PAYMENT EIP-3009 payload, facilitator-settled (standard rail). Omit if using payment_tx_hash.'),
    },
    async (rawArgs) => {
      const args = Sandbox.validate(InputSchema, rawArgs);
      const audit = AuditLogger.getInstance();

      if (!RateLimiter.getInstance().checkTool('nexus_agent_hire')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded' }) }], isError: true };
      }

      // Backed by SqueezeOS's real, live Agent Hiring Protocol board
      // (core/api/hiring_bp.py, /api/hiring) — fixed 2026-08-01, previously
      // called a dead host (api.scriptmasterlabs.com/nexus/v1/*) with no
      // real backend anywhere. Zero custody: bounties settle wallet-to-
      // wallet on XRPL, outside this gateway entirely.

      // Free query tier — browse real open jobs.
      if (args.action === 'query') {
        const upperCapability = args.capability.trim().toUpperCase();
        const jobTypeFilter = VALID_JOB_TYPES.has(upperCapability) ? upperCapability : undefined;

        let browseResult: unknown;
        try {
          browseResult = await SqueezeOSAPI.hiringBrowse({ jobType: jobTypeFilter, symbol: args.symbol });
        } catch (err) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'upstream_unavailable', message: String(err) }) }], isError: true };
        }

        // capability didn't match a real job_type enum value — filter the
        // real result set client-side by keyword instead of guessing.
        let results = browseResult as { jobs?: HiringJob[]; [key: string]: unknown };
        if (!jobTypeFilter && results?.jobs) {
          const needle = args.capability.trim().toLowerCase();
          const filtered = results.jobs.filter((j) => j.description?.toLowerCase().includes(needle) || j.job_type?.toLowerCase().includes(needle));
          results = { ...results, jobs: filtered, open_jobs: filtered.length, filtered_by_keyword: args.capability };
        }

        audit.info('nexus_query_success', { capability: args.capability });
        return { content: [{ type: 'text', text: JSON.stringify({ data: results, tier: 'free' }) }] };
      }

      // Hire — posts a real job to the board, commission-based mcp-x402 fee.
      if (!args.xrpl_wallet || !args.xrpl_wallet.startsWith('r') || args.xrpl_wallet.length < 25) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'xrpl_wallet_required', message: 'A valid XRPL wallet (starts with "r", 25+ chars) is required to post a job on SqueezeOS\'s zero-custody board.' }) }], isError: true };
      }

      const requirements = args.agent_id ? `Requested executor: ${args.agent_id}` : undefined;

      // Fetch BEFORE charging — never bill for a call we can't fulfill.
      let hireResult: unknown;
      try {
        hireResult = await SqueezeOSAPI.hiringPost({
          posterXrplWallet: args.xrpl_wallet,
          description: args.capability,
          bountyRlusd: parseFloat(args.max_budget),
          symbol: args.symbol,
          requirements,
        });
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'upstream_unavailable', message: String(err) }) }], isError: true };
      }

      const agentFee = parseFloat(args.max_budget);
      const commission = (agentFee * COMMISSION_RATE).toFixed(4);

      let payment;
      try {
        payment = await executeX402Payment({
          price: commission,
          currency: 'USDC',
          toolName: 'nexus_agent_hire',
          walletAddress: args.wallet_address,
          paymentTxHash: args.payment_tx_hash,
          paymentHeader: args.payment_header,
        });
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }

      audit.info('nexus_hire_success', { xrplWallet: args.xrpl_wallet, commission, receiptId: payment.receiptId });
      return {
        content: [{ type: 'text', text: JSON.stringify({ data: hireResult, commission: `${commission} USDC (5% mcp-x402 facilitation fee)`, note: 'Job posted on SqueezeOS\'s real Agent Hiring Protocol board. The bounty pays out wallet-to-wallet on XRPL once an executor delivers and you confirm — SqueezeOS never holds the funds.', _meta: { receipt_id: payment.receiptId, tx_hash: payment.txHash, chain: payment.chain } }) }],
      };
    },
  );
}
