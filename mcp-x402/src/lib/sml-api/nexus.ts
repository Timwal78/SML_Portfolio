export interface NexusQueryParams {
  capability: string;
  maxBudget: string;
}

export interface NexusHireParams {
  agentId: string;
  budget: string;
  chainPreference?: string;
}

export class NexusClient {
  private static instance: NexusClient;
  private readonly baseUrl: string;

  private constructor() {
    this.baseUrl = process.env['SML_API_BASE'] ?? 'https://api.scriptmasterlabs.com';
  }

  static getInstance(): NexusClient {
    if (!NexusClient.instance) {
      NexusClient.instance = new NexusClient();
    }
    return NexusClient.instance;
  }

  async queryAgents(params: NexusQueryParams): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/nexus/v1/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capability: params.capability, max_budget: params.maxBudget }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) throw new Error(`Nexus API error: HTTP ${res.status}`);
    return res.json();
  }

  async hireAgent(params: NexusHireParams): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/nexus/v1/agents/${params.agentId}/hire`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ budget: params.budget, chain_preference: params.chainPreference }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) throw new Error(`Nexus hire error: HTTP ${res.status}`);
    return res.json();
  }
}
