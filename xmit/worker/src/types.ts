export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  ENVIRONMENT: string;
  BASE_CHAIN_ID: string;
  USDC_ADDRESS: string;
  X402_FACILITATOR_URL: string;
  EDGAR_BASE_URL: string;
  X402_RESOURCE_PRIVATE_KEY: string;
  XMIT_CONTRACT_ADDRESS: string;
}

export type Module = 'xcgo' | 'xstm' | 'xifd';

export type LoyaltyTier =
  | 'CITIZEN'
  | 'DELEGATE'
  | 'SENATOR'
  | 'PRESIDENT'
  | 'SOVEREIGN';

export interface Analyst {
  address: string;
  displayName: string | null;
  reputationScore: number;
  totalInsights: number;
  correctPredictions: number;
  tier: LoyaltyTier;
  streakDays: number;
  createdAt: string;
  modules: Record<Module, ModuleStats>;
}

export interface ModuleStats {
  insightCount: number;
  accuracy: number;
  earnings: string; // USDC wei string
}

export interface Insight {
  id: string;
  analystAddress: string;
  module: Module;
  ticker: string;
  title: string;
  summary: string; // free preview
  confidenceScore: number; // 0-100
  priceMicro: number; // USDC in micros (100 = $0.000100, 100000 = $0.10)
  paymentAddress: string; // analyst's Base address for x402 payment
  edgarFilingId: string | null;
  edgarFormType: string | null;
  evidenceHash: string | null; // keccak256 of full evidence JSON stored in R2
  submittedAt: string;
  scoredAt: string | null;
  outcomeVerdict: 'PENDING' | 'CORRECT' | 'INCORRECT' | 'UNRESOLVABLE';
  reputationDelta: number | null;
  viewCount: number;
  purchaseCount: number;
}

export interface EdgarFiling {
  accessionNumber: string;
  cik: string;
  formType: string;
  filedAt: string;
  companyName: string;
  ticker: string | null;
  documentUrl: string;
  rawXml: string | null;
}

export interface GovernanceScore {
  ticker: string;
  companyName: string;
  overallGrade: string; // A+ to F
  score: number; // 0-100
  boardIndependence: number;
  ceoPayRatio: number | null;
  auditCommitteeScore: number;
  redFlagCount: number;
  proxyFilingDate: string;
  meetingDate: string | null;
  analystConsensus: 'VOTE_FOR' | 'VOTE_AGAINST' | 'ABSTAIN' | 'SPLIT';
  keyIssues: string[];
}

export interface RedFlagReport {
  id: string;
  ticker: string;
  companyName: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  category:
    | 'RELATED_PARTY'
    | 'AUDITOR_CHANGE'
    | 'INSIDER_TRADE'
    | 'RESTATEMENT'
    | 'LITIGATION'
    | 'GOING_CONCERN'
    | 'ACCOUNTING_ANOMALY';
  title: string;
  summary: string;
  evidenceUrls: string[];
  detectedAt: string;
  resolutionStatus: 'OPEN' | 'RESOLVED' | 'ESCALATED';
}

export interface InstitutionalFlow {
  institutionName: string;
  cik: string;
  ticker: string;
  periodOfReport: string;
  previousShares: number | null;
  currentShares: number;
  changePct: number | null;
  action: 'NEW' | 'INCREASED' | 'DECREASED' | 'EXITED';
  estimatedValueUsd: number | null;
  filedAt: string;
  form13FAccession: string;
}

export interface TickerSummary {
  ticker: string;
  companyName: string;
  governanceGrade: string | null;
  redFlagCount: number;
  institutionalSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNKNOWN';
  topAnalysts: Array<{ address: string; module: Module; reputation: number }>;
  lastUpdated: string;
}

export interface PaymentRequired {
  type: 'x402';
  accepts: Array<{
    scheme: 'exact';
    network: string;
    maxAmountRequired: string;
    resource: string;
    description: string;
    mimeType: string;
    payTo: string;
    maxTimeoutSeconds: number;
    asset: string;
    extra: { name: string; version: string };
  }>;
}
