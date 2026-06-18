import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Original 6 tools
import { registerLeviathan } from './leviathan.js';
import { registerXmit } from './xmit.js';
import { registerXdeo } from './xdeo.js';
import { registerFtd } from './ftd.js';
import { registerNexus } from './nexus.js';
import { registerCrawl } from './crawl.js';

// SML Product Catalog expansion
import { registerSqueezeOS } from './squeezeos.js';
import { registerGhost } from './ghost.js';
import { registerProof402 } from './proof402.js';
import { registerRails } from './rails.js';
import { registerCopyTrader } from './copytrader.js';
import { registerLaunchpad } from './launchpad.js';
import { registerShadow } from './shadow.js';
import { registerForge } from './forge.js';
import { registerAgentCard } from './agentcard.js';
import { registerEcho } from './echo.js';

export async function registerTools(server: McpServer): Promise<void> {
  // ── Original tools ─────────────────────────────────────────────────────────
  await registerLeviathan(server);
  await registerXmit(server);
  await registerXdeo(server);
  await registerFtd(server);
  await registerNexus(server);
  await registerCrawl(server);

  // ── SqueezeOS (8 free + 5 paid = 13 tools) ────────────────────────────────
  registerSqueezeOS(server);

  // ── Ghost Layer (1 free + 1 paid = 2 tools) ───────────────────────────────
  registerGhost(server);

  // ── 402Proof (3 free tools) ───────────────────────────────────────────────
  registerProof402(server);

  // ── RLUSD Rails (1 free + 1 paid = 2 tools) ──────────────────────────────
  registerRails(server);

  // ── Copy-Trader (2 free + 1 paid = 3 tools) ──────────────────────────────
  registerCopyTrader(server);

  // ── Launchpad (2 free + 2 paid = 4 tools) ────────────────────────────────
  registerLaunchpad(server);

  // ── Shadow Desk (2 paid tools) ────────────────────────────────────────────
  registerShadow(server);

  // ── Forge Gateway (1 free + 1 paid = 2 tools) ────────────────────────────
  registerForge(server);

  // ── AgentCard (2 free + 1 paid = 3 tools) ────────────────────────────────
  registerAgentCard(server);

  // ── echo-forge (1 paid stub = 1 tool) ────────────────────────────────────
  registerEcho(server);
}

/*
  Total tool count: 6 (original) + 13 (SqueezeOS) + 2 (Ghost) + 3 (402Proof)
                  + 2 (Rails) + 3 (CopyTrader) + 4 (Launchpad) + 2 (Shadow)
                  + 2 (Forge) + 3 (AgentCard) + 1 (Echo)
                  = 41 tools
*/
