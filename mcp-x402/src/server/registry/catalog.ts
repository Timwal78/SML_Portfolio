export interface ToolMeta {
  name: string;
  description: string;
  price: string;
  currency: 'USDC' | 'RLUSD';
  freeTier?: string;
  ap2Required: boolean;
  cacheTtl?: number;
}

export const CATALOG: ToolMeta[] = [
  {
    name: 'leviathan_signal',
    description: 'Institutional-grade squeeze signals. Multi-engine verdict for any ticker.',
    price: '0.05',
    currency: 'USDC',
    ap2Required: true,
  },
  {
    name: 'xmit_edgar_decode',
    description: 'Parse SEC DEF 14A / 13F / 13D filings. Raw text never leaves SML servers.',
    price: '0.02',
    currency: 'USDC',
    ap2Required: true,
  },
  {
    name: 'xdeo_earnings_estimate',
    description: 'Decentralized earnings oracle. +2 bureau_score on success.',
    price: '0.02',
    currency: 'USDC',
    ap2Required: true,
  },
  {
    name: 'ftd_threshold_scan',
    description: 'SEC Reg SHO FTD data. Alerts free; full data 0.05 USDC. 15-min cache.',
    price: '0.05',
    currency: 'USDC',
    ap2Required: false,
    freeTier: 'alerts_only',
    cacheTtl: 900,
  },
  {
    name: 'nexus_agent_hire',
    description: 'Agent marketplace. Query free; hire charges 5% commission.',
    price: '0.00',
    currency: 'USDC',
    ap2Required: false,
    freeTier: 'query_only',
  },
  {
    name: 'crawl_paid_fetch',
    description: 'Pay-per-fetch scraping. Humans bypass free.',
    price: '0.005',
    currency: 'USDC',
    ap2Required: false,
  },
];

export function getToolMeta(name: string): ToolMeta | undefined {
  return CATALOG.find((t) => t.name === name);
}
