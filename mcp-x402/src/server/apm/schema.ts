/**
 * Agent Preference Manifest (APM) — the "ask, don't tell" schema.
 *
 * An agent declares what it NEEDS; SML answers with matching live tools.
 * These types double as the published APM standard.
 */

import { z } from 'zod';

export const ChainEnum = z.enum(['base', 'xrpl', 'solana']);

export const ConstraintsSchema = z.object({
  /** Max USD the agent will pay per downstream tool call. */
  max_price_usd: z.number().nonnegative().optional(),
  /** Payment chains the agent accepts. Empty/omitted = any. */
  chains_accepted: z.array(ChainEnum).optional(),
  /** Max acceptable data staleness, in seconds. */
  max_freshness_sec: z.number().int().nonnegative().optional(),
  /** Require tools that cite authoritative sources. */
  needs_attribution: z.boolean().optional(),
  /** Agent's expected credit-score floor (informational; payment layer enforces >=300). */
  min_credit_score: z.number().int().optional(),
});

export const ManifestSchema = z.object({
  need: z.string().min(2).max(500),
  mode: z.enum(['preview', 'contract']).default('preview'),
  wallet_address: z.string().optional(),
  payment_tx_hash: z.string().optional(),
  payment_header: z.string().optional(),
  agent_id: z.string().optional(),
  constraints: ConstraintsSchema.optional(),
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type Constraints = z.infer<typeof ConstraintsSchema>;

export interface ConstraintFit {
  price: boolean;
  chain: boolean;
  freshness: boolean;
  attribution: boolean;
}

export interface ScoredMatch {
  tool: string;
  product: string;
  summary: string;
  paid: boolean;
  price_usd: string;
  payment_chains: string[];
  freshness_sec: number;
  attribution: boolean;
  live: boolean;
  score: number;
  fits: ConstraintFit;
  meets_all_constraints: boolean;
}
