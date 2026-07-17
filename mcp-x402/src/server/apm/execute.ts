/**
 * APM execution layer — what apm_execute can broker today and the brokerage math.
 *
 * v1 brokers the LIVE SqueezeOS family (verified online). Each executor maps a tool
 * name to the real SML API client call; apm_execute collects the locked price +
 * brokerage, then runs the tool through SML's own paid path.
 */

import { SqueezeOSAPI } from '../../lib/sml-api/squeezeos.js';

export interface BrokerArgs {
  symbol?: string;
  wallet_address: string;
}

/** Locked price * (1 + brokerage%), at USDC-native (6-decimal) precision. */
export function brokeredTotal(priceUsd: string, brokeragePct: number): string {
  const total = parseFloat(priceUsd) * (1 + brokeragePct / 100);
  return (Math.round(total * 1e6) / 1e6).toString();
}

/** Tools apm_execute can broker right now (live SqueezeOS family). */
export const BROKERABLE_TOOLS: Record<string, (args: BrokerArgs) => Promise<unknown>> = {
  squeezeos_council: (a) => {
    if (!a.symbol) throw new Error('squeezeos_council requires a `symbol`.');
    return SqueezeOSAPI.council(a.symbol, a.wallet_address);
  },
  squeezeos_scan: (a) => SqueezeOSAPI.scan(a.wallet_address),
  squeezeos_options: (a) => SqueezeOSAPI.options(a.wallet_address),
  squeezeos_iwm: (a) => SqueezeOSAPI.iwm(a.wallet_address),
};

export function isBrokerable(tool: string): boolean {
  return Object.prototype.hasOwnProperty.call(BROKERABLE_TOOLS, tool);
}

export function brokerableTools(): string[] {
  return Object.keys(BROKERABLE_TOOLS);
}
