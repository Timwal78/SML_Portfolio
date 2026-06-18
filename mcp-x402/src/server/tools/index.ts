import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerLeviathan } from './leviathan.js';
import { registerXmit } from './xmit.js';
import { registerXdeo } from './xdeo.js';
import { registerFtd } from './ftd.js';
import { registerNexus } from './nexus.js';
import { registerCrawl } from './crawl.js';

export async function registerTools(server: McpServer): Promise<void> {
  await registerLeviathan(server);
  await registerXmit(server);
  await registerXdeo(server);
  await registerFtd(server);
  await registerNexus(server);
  await registerCrawl(server);
}
