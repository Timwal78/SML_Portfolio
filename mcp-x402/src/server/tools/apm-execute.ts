import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeBrokeredPayment } from '../payments/x402.js';
import { RateLimiter } from '../security/rate-limit.js';
import { Sandbox } from '../security/sandbox.js';
import { AuditLogger } from '../security/audit.js';
import { verifyAndParseQuote } from '../apm/quote.js';
import { BROKERABLE_TOOLS, isBrokerable, brokerableTools, brokeredTotal } from '../apm/execute.js';

const ExecuteSchema = z.object({
  quote_canonical: z.string().min(2),
  quote_signature: z.string().min(2),
  tool: z.string().min(1),
  wallet_address: z.string().min(1),
  symbol: z.string().optional(),
  payment_tx_hash: z.string().optional(),
  payment_header: z.string().optional(),
});

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: true };
const ok = (p: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(p, null, 2) }] });
const fail = (error: string, extra: Record<string, unknown> = {}): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify({ error, ...extra }) }],
  isError: true,
});

export function registerApmExecute(server: McpServer): void {
  const audit = AuditLogger.getInstance();

  server.tool(
    'apm_execute',
    "Execute a tool recommended by apm_negotiate under its price-locked signed quote, collecting the agreed brokerage. Pass the quote's `canonical` + `signature` (from the Service Capability Contract), the tool name, and any args (e.g. `symbol`). Charges the locked price + brokerage, runs the tool, returns the result. Requires APM_QUOTE_SECRET on the gateway.",
    {
      quote_canonical: z.string().describe('The `quote.canonical` string from apm_negotiate (mode=contract).'),
      quote_signature: z.string().describe('The `quote.signature` from apm_negotiate — proves the SML price-lock.'),
      tool: z.string().describe('Tool to execute. Must match the quote and be brokerable (e.g. squeezeos_council).'),
      wallet_address: z.string().describe('Wallet that pays the brokered total.'),
      symbol: z.string().optional().describe('Ticker symbol, when the tool needs one (e.g. squeezeos_council).'),
      payment_tx_hash: z.string().optional().describe('On-chain Base tx hash proving USDC payment to the operator (sovereign rail). Omit if using payment_header.'),
      payment_header: z.string().optional().describe('Base64 X-PAYMENT EIP-3009 payload, facilitator-settled (standard rail). Omit if using payment_tx_hash.'),
    },
    async (rawArgs): Promise<ToolResult> => {
      const args = Sandbox.validate(ExecuteSchema, rawArgs);

      if (!RateLimiter.getInstance().checkTool('apm_execute')) {
        return fail('rate_limit_exceeded', { retry_after: 60 });
      }

      // 1. Verify the price-locked quote (needs APM_QUOTE_SECRET set on the gateway).
      const check = verifyAndParseQuote(args.quote_canonical, args.quote_signature);
      if (!check.valid || !check.quote) {
        return fail('quote_invalid', {
          reason: check.reason,
          hint: 'Signature failed. Ensure APM_QUOTE_SECRET is set and you passed the exact canonical+signature from apm_negotiate (mode=contract).',
        });
      }
      if (check.expired) {
        return fail('quote_expired', { expires_at: check.quote.expires_at, hint: 'Re-run apm_negotiate (mode=contract) for a fresh quote.' });
      }
      if (check.quote.tool !== args.tool) {
        return fail('tool_quote_mismatch', { quote_tool: check.quote.tool, requested_tool: args.tool });
      }
      if (!isBrokerable(args.tool)) {
        return fail('tool_not_brokerable', { tool: args.tool, brokerable: brokerableTools(), hint: 'apm_execute brokers the live SqueezeOS family today; more tools coming.' });
      }

      // 2. Collect locked price + brokerage (amount integrity = the SML-signed quote).
      const total = brokeredTotal(check.quote.price_usd, check.quote.brokerage_commission_pct);
      let payment;
      try {
        payment = await executeBrokeredPayment({ amount: total, toolName: `apm_execute:${args.tool}`, walletAddress: args.wallet_address, paymentTxHash: args.payment_tx_hash, paymentHeader: args.payment_header });
      } catch (err) {
        audit.warn('apm_execute_payment_fail', { error: String(err) });
        return fail('payment_failed', { message: String(err) });
      }

      // 3. Run the brokered tool through SML's own paid path.
      try {
        const data = await BROKERABLE_TOOLS[args.tool]!({ symbol: args.symbol, wallet_address: args.wallet_address });
        audit.info('apm_execute_success', { tool: args.tool, receiptId: payment.receiptId });
        return ok({
          tool: args.tool,
          data,
          brokerage: {
            locked_price_usd: check.quote.price_usd,
            commission_pct: check.quote.brokerage_commission_pct,
            total_charged_usd: total,
          },
          _meta: {
            receipt_id: payment.receiptId,
            tx_hash: payment.txHash,
            chain: payment.chain,
            amount_paid: `${payment.amountPaid} ${payment.currency}`,
            timestamp: payment.timestamp,
          },
        });
      } catch (err) {
        audit.error('apm_execute_tool_fail', { tool: args.tool, error: String(err) });
        return fail('tool_execution_failed', {
          message: String(err),
          receipt_id: payment.receiptId,
          note: 'Payment was collected; the brokered tool call failed (e.g. backend offline). Receipt retained.',
        });
      }
    },
  );
}
