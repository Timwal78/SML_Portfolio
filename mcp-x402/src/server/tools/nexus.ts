import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeX402Payment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { NexusClient } from '../../lib/sml-api/nexus.js';

const InputSchema = z.object({
  capability: z.string().min(1).max(200),
  max_budget: z.string().regex(/^\d+(\.\d+)?$/),
  chain_preference: z.enum(['base', 'xrpl', 'solana']).optional(),
  action: z.enum(['query', 'hire']).default('query'),
  agent_id: z.string().optional(),
  wallet_address: z.string().optional(),
});

const COMMISSION_RATE = 0.05;

export function registerNexus(server: McpServer): void {
  server.tool(
    'nexus_agent_hire',
    {
      capability: { type: 'string', description: 'Capability or skill to search for (e.g. "options flow analysis").' },
      max_budget: { type: 'string', description: 'Max budget in USDC for hire (e.g. "1.00").' },
      chain_preference: { type: 'string', enum: ['base', 'xrpl', 'solana'], description: 'Preferred payment chain.' },
      action: { type: 'string', enum: ['query', 'hire'], description: '"query" is free. "hire" charges 5% commission on agent fee.' },
      agent_id: { type: 'string', description: 'Agent ID to hire (required for action=hire).' },
      wallet_address: { type: 'string', description: 'Agent wallet for payment.' },
    },
    async (rawArgs) => {
      const args = Sandbox.validate(InputSchema, rawArgs);
      const audit = AuditLogger.getInstance();

      if (!RateLimiter.getInstance().checkTool('nexus_agent_hire')) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'rate_limit_exceeded' }) }], isError: true };
      }

      const client = NexusClient.getInstance();

      // Free query tier
      if (args.action === 'query') {
        const results = await client.queryAgents({ capability: args.capability, maxBudget: args.max_budget });
        audit.info('nexus_query_success', { capability: args.capability });
        return { content: [{ type: 'text', text: JSON.stringify({ data: results, tier: 'free' }) }] };
      }

      // Hire — commission-based payment
      if (!args.agent_id) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'agent_id_required', message: 'Specify agent_id to hire.' }) }], isError: true };
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
        });
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'payment_failed', message: String(err) }) }], isError: true };
      }

      const hireResult = await client.hireAgent({ agentId: args.agent_id, budget: args.max_budget, chainPreference: args.chain_preference });

      audit.info('nexus_hire_success', { agentId: args.agent_id, commission, receiptId: payment.receiptId });
      return {
        content: [{ type: 'text', text: JSON.stringify({ data: hireResult, commission: `${commission} USDC (5%)`, _meta: { receipt_id: payment.receiptId, tx_hash: payment.txHash, chain: payment.chain } }) }],
      };
    },
  );
}
