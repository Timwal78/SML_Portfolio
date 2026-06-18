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
import { registerDiscovery } from './discovery.js';
import { registerAgentCard } from './agentcard.js';
import { registerEcho } from './echo.js';
import { registerCopyTrader } from './copytrader.js';
import { registerRails } from './rails.js';
import { registerShadow } from './shadow.js';
import { registerForge } from './forge.js';
import { registerLaunchpad } from './launchpad.js';
import { registerBacktest } from './backtest.js';
import { registerBrokers } from './brokers.js';

export async function registerTools(server: McpServer): Promise<void> {
  // Discovery layer — always first so agents can orient
  registerDiscovery(server);
  registerProof402(server);

  // SML Intelligence stack
  registerSqueezeOS(server);
  registerLeviathan(server);
  registerXdeo(server);
  registerXmit(server);
  registerFtd(server);

  // Backtest & validation engine
  registerBacktest(server);

  // Agent commerce
  registerNexus(server);
  registerCrawl(server);
  registerEcho(server);
  registerAgentCard(server);

  // Broker execution rails
  registerBrokers(server);

  // Infrastructure rails
  registerGhost(server);
  registerRails(server);
  registerShadow(server);
  registerForge(server);
  registerCopyTrader(server);
  registerLaunchpad(server);
}
