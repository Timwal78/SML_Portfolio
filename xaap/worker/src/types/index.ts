export type Tier = 'CITIZEN' | 'DETECTIVE' | 'INVESTIGATOR' | 'AUDITOR' | 'GRAND_INQUISITOR';
export type FindingSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type FindingCategory =
  | 'RELATED_PARTY'
  | 'AUDITOR_CHANGE'
  | 'GOING_CONCERN'
  | 'REVENUE_RECOGNITION'
  | 'EXECUTIVE_COMP'
  | 'SUBSIDIARY'
  | 'INSIDER_TRADING'
  | 'OTHER';
export type FindingStatus = 'PENDING' | 'VALIDATED' | 'INVALIDATED' | 'EXPIRED';
export type HealthGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' | 'PENDING';
export type FilingType = '10-K' | '10-Q' | '8-K' | '13F' | '13D' | 'Form4' | 'DEF14A';

export interface Auditor {
  address: string;
  ens_name: string | null;
  display_name: string | null;
  tier: Tier;
  reputation_score: number;
  accuracy_rate: number;
  total_findings: number;
  validated_findings: number;
  streak_days: number;
  total_earned_usdc: string;
  created_at: number;
}

export interface Finding {
  id: string;
  ticker: string;
  auditor_address: string;
  title: string;
  summary: string;
  full_thesis?: string;
  evidence_cid: string | null;
  evidence_hash: string | null;
  severity: FindingSeverity;
  category: FindingCategory;
  price_usdc: string;
  status: FindingStatus;
  filing_type: FilingType | null;
  is_free_preview: boolean;
  access_count: number;
  created_at: number;
}

export interface Ticker {
  symbol: string;
  company_name: string;
  cik: string | null;
  sector: string | null;
  health_grade: HealthGrade;
  health_score: number;
  red_flag_count: number;
  severe_flag_count: number;
  auditor_count: number;
}

export interface RedFlag {
  type: string;
  severity: FindingSeverity;
  description: string;
  evidence_snippet: string;
  filing_ref: string;
}

export interface Achievement {
  badge_id: string;
  label: string;
  description: string;
  earned_at: number;
}

export interface AgentRecord {
  agent_id: string;
  name: string;
  total_referrals: number;
  total_volume_usdc: string;
  lifetime_payout_usdc: string;
}

export interface Env {
  DB: D1Database;
  EVIDENCE: R2Bucket;
  CACHE: KVNamespace;
  MERCHANT_WALLET_ADDRESS: string;
  X402_FACILITATOR_URL: string;
  EDGAR_USER_AGENT: string;
  XAAP_CORE_ADDRESS: string;
  ADMIN_API_KEY: string;
  DISCORD_WEBHOOK_FINDINGS: string;
  DISCORD_WEBHOOK_VERDICTS: string;
  PROTOCOL_FEE_BPS: string;
  FREE_DELAY_HOURS: string;
  ENVIRONMENT: string;
}

export const TIER_REQUIREMENTS: Record<Tier, { min_findings: number; min_accuracy: number; top_n?: number }> = {
  CITIZEN: { min_findings: 0, min_accuracy: 0 },
  DETECTIVE: { min_findings: 3, min_accuracy: 0 },
  INVESTIGATOR: { min_findings: 15, min_accuracy: 0.7 },
  AUDITOR: { min_findings: 30, min_accuracy: 0.8, top_n: 50 },
  GRAND_INQUISITOR: { min_findings: 100, min_accuracy: 0.9, top_n: 10 },
};

export const TIER_FEES: Record<Tier, number> = {
  CITIZEN: 500,        // 5% protocol fee
  DETECTIVE: 400,      // 4%
  INVESTIGATOR: 300,   // 3%
  AUDITOR: 200,        // 2%
  GRAND_INQUISITOR: 100, // 1%
};

export const STREAK_MULTIPLIERS: Array<{ days: number; multiplier: number }> = [
  { days: 100, multiplier: 5.0 },
  { days: 30, multiplier: 2.5 },
  { days: 7, multiplier: 1.5 },
  { days: 0, multiplier: 1.0 },
];

export const BADGES = {
  FIRST_BLOOD: { label: 'First Blood', description: 'First validated red flag' },
  ENRONS_REVENGE: { label: "Enron's Revenge", description: 'Predicted collapse before restatement' },
  GHOST_HUNTER: { label: 'Ghost Hunter', description: 'Found undisclosed related party via OpenCorporates' },
  SATELLITE_SLEUTH: { label: 'Satellite Sleuth', description: 'Caught factory shutdown via satellite imagery' },
  WAYBACK_WARRIOR: { label: 'Wayback Warrior', description: 'Recovered deleted disclosure via Wayback Machine' },
  CENTURION: { label: 'Centurion', description: '100 findings submitted' },
  PROPHET: { label: 'Prophet', description: '10 consecutive validations' },
  IRON_JUROR: { label: 'Iron Juror', description: '50 correct jury votes' },
} as const;

export type BadgeId = keyof typeof BADGES;
