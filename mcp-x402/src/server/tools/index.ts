import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerLeviathan } from './leviathan.js';
import { registerXmit } from './xmit.js';
import { registerXdeo } from './xdeo.js';
import { registerFtd } from './ftd.js';
import { registerNexus } from './nexus.js';
import { registerCrawl } from './crawl.js';
import { registerSqueezeOS } from './squeezeos.js';
import { registerGhost } from './ghost.js';
import { registerProof402 } from './proof402.js';
import { registerRails } from './rails.js';
import { registerCopyTrader } from './copytrader.js';
import { registerLaunchpad } from './launchpad.js';
import { registerShadow } from './shadow.js';
import { registerForge } from './forge.js';
import { registerAgentcard } from './agentcard.js';
import { registerEcho } from './echo.js';
import { registerDiscovery } from './discovery.js';

export async function registerTools(server: McpServer): Promise<void> {
  // Discovery tools — register first so agents find them immediately
  await registerDiscovery(server);

  // SqueezeOS — 13 tools (8 free, 5 paid)
  await registerSqueezeOS(server);

  // Ghost Layer — 2 tools (1 free, 1 paid)
  await registerGhost(server);

  // 402Proof — 3 tools (all free)
  await registerProof402(server);

  // RLUSD Rails — 2 tools (1 free, 1 paid)
  await registerRails(server);

  // XRPL Copy-Trader — 3 tools (2 free, 1 paid)
  await registerCopyTrader(server);

  // Memecoin Launchpad — 4 tools (2 free, 2 paid)
  await registerLaunchpad(server);

  // Shadow Desk — 2 tools (both paid)
  await registerShadow(server);

  // Forge Gateway — 2 tools (1 free, 1 paid)
  await registerForge(server);

  // agentcard — 3 tools (2 free, 1 paid)
  await registerAgentcard(server);

  // echo-forge — 1 tool (paid stub, coming soon)
  await registerEcho(server);

  // Original 6 Core SML Intelligence tools
  await registerLeviathan(server);
  await registerXmit(server);
  await registerXdeo(server);
  await registerFtd(server);
  await registerNexus(server);
  await registerCrawl(server);
}
