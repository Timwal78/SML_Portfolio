import { readFileSync } from 'fs';
import { join } from 'path';

interface AgentsJson {
  schema_version: string;
  name: string;
  tools: unknown[];
}

export class Discovery {
  private static instance: Discovery;
  private agentsJson: AgentsJson | null = null;
  private llmsTxt: string | null = null;

  private constructor() {}

  static getInstance(): Discovery {
    if (!Discovery.instance) {
      Discovery.instance = new Discovery();
    }
    return Discovery.instance;
  }

  getAgentsJson(): AgentsJson {
    if (!this.agentsJson) {
      const path = join(process.cwd(), 'agents.json');
      this.agentsJson = JSON.parse(readFileSync(path, 'utf8')) as AgentsJson;
    }
    return this.agentsJson;
  }

  getLlmsTxt(): string {
    if (!this.llmsTxt) {
      const path = join(process.cwd(), 'llms.txt');
      this.llmsTxt = readFileSync(path, 'utf8');
    }
    return this.llmsTxt;
  }
}
