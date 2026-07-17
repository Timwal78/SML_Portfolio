// Fire-and-forget Discord webhook alerts for heatmap tool sales. Never blocks
// or fails a tool call: a missing DISCORD_WEBHOOK_URL, a network error, or a
// non-2xx response are all swallowed (logged via AuditLogger, not thrown).

import { AuditLogger } from '../../server/security/audit.js';
import type { HeatmapResult } from '../quant/heatmap.js';

const DISCORD_WEBHOOK_URL = process.env['DISCORD_WEBHOOK_URL'] ?? '';

export interface HeatmapExtreme {
  symbol: string;
  value: number;
  group: string;
}

/** Scans every group for the single highest- and lowest-value items. */
export function pickExtremes(heatmap: HeatmapResult): { top: HeatmapExtreme | null; bottom: HeatmapExtreme | null } {
  let top: HeatmapExtreme | null = null;
  let bottom: HeatmapExtreme | null = null;
  for (const group of heatmap.groups) {
    for (const item of group.items) {
      if (!top || item.value > top.value) top = { symbol: item.symbol, value: item.value, group: group.group };
      if (!bottom || item.value < bottom.value) bottom = { symbol: item.symbol, value: item.value, group: group.group };
    }
  }
  return { top, bottom };
}

export type HeatmapToolName = 'equities_heatmap_full' | 'options_delta_heatmap_full';

export interface HeatmapAlertInput {
  toolName: HeatmapToolName;
  amountPaid: string;
  currency: string;
  walletAddress: string;
  heatmap: HeatmapResult;
  synthesis: string;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

const TOOL_LABELS: Record<HeatmapToolName, string> = {
  equities_heatmap_full: 'Equities RSI Heatmap',
  options_delta_heatmap_full: 'Options Delta Heatmap',
};

/**
 * Post a rich embed to DISCORD_WEBHOOK_URL announcing a paid heatmap call.
 * Fire-and-forget by design — the caller does not await this, so a slow or
 * failed webhook can never add latency or an error path to the tool response.
 */
export function notifyHeatmapSale(input: HeatmapAlertInput): void {
  if (!DISCORD_WEBHOOK_URL) return;

  const { top, bottom } = pickExtremes(input.heatmap);

  const embed = {
    title: `💰 ${TOOL_LABELS[input.toolName]} — ${input.amountPaid} ${input.currency}`,
    color: 0xa78bfa,
    fields: [
      { name: 'Top overbought', value: top ? `${top.symbol} — ${top.value.toFixed(1)} (${top.group})` : 'n/a', inline: true },
      { name: 'Top oversold', value: bottom ? `${bottom.symbol} — ${bottom.value.toFixed(1)} (${bottom.group})` : 'n/a', inline: true },
      { name: 'Swarm synthesis', value: truncate(input.synthesis, 300) },
    ],
    footer: { text: `wallet ${input.walletAddress.slice(0, 10)}… · mcp-x402` },
    timestamp: new Date().toISOString(),
  };

  fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
    signal: AbortSignal.timeout(5_000),
  })
    .then((res) => {
      if (!res.ok) {
        AuditLogger.getInstance().warn('discord_alert_failed', { status: res.status, tool: input.toolName });
      }
    })
    .catch((err) => {
      AuditLogger.getInstance().warn('discord_alert_error', { error: String(err), tool: input.toolName });
    });
}
