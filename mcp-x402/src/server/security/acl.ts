import { z } from 'zod';

export const ToolACLSchema = z.object({
  toolName: z.string(),
  walletAddress: z.string().optional(),
  creditScore: z.number().optional(),
  paidTier: z.boolean().default(false),
});

export type ToolACL = z.infer<typeof ToolACLSchema>;

const FREE_TOOLS = new Set(['ftd_threshold_scan_alerts', 'nexus_agent_hire_query']);

export class ACL {
  private static instance: ACL;

  private constructor() {}

  static getInstance(): ACL {
    if (!ACL.instance) {
      ACL.instance = new ACL();
    }
    return ACL.instance;
  }

  isFree(toolName: string): boolean {
    return FREE_TOOLS.has(toolName);
  }

  requiresPayment(toolName: string): boolean {
    return !this.isFree(toolName);
  }

  requiresAP2(toolName: string): boolean {
    // leviathan, xmit, xdeo require AP2 per spec
    return ['leviathan_signal', 'xmit_edgar_decode', 'xdeo_earnings_estimate'].includes(toolName);
  }

  minCreditScore(_toolName: string): number {
    return 300;
  }
}
