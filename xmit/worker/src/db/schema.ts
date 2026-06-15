export const SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS analysts (
  address TEXT PRIMARY KEY,
  display_name TEXT,
  reputation_score REAL NOT NULL DEFAULT 0,
  total_insights INTEGER NOT NULL DEFAULT 0,
  correct_predictions INTEGER NOT NULL DEFAULT 0,
  tier TEXT NOT NULL DEFAULT 'CITIZEN',
  streak_days INTEGER NOT NULL DEFAULT 0,
  last_active_date TEXT,
  referrer_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS module_stats (
  analyst_address TEXT NOT NULL,
  module TEXT NOT NULL CHECK (module IN ('xcgo', 'xstm', 'xifd')),
  insight_count INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  total_earned_micro INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (analyst_address, module),
  FOREIGN KEY (analyst_address) REFERENCES analysts(address)
);

CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY,
  analyst_address TEXT NOT NULL,
  module TEXT NOT NULL CHECK (module IN ('xcgo', 'xstm', 'xifd')),
  ticker TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  confidence_score INTEGER NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  price_micro INTEGER NOT NULL DEFAULT 100000,
  payment_address TEXT NOT NULL,
  edgar_filing_id TEXT,
  edgar_form_type TEXT,
  evidence_hash TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  scored_at TEXT,
  outcome_verdict TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (outcome_verdict IN ('PENDING', 'CORRECT', 'INCORRECT', 'UNRESOLVABLE')),
  reputation_delta REAL,
  view_count INTEGER NOT NULL DEFAULT 0,
  purchase_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (analyst_address) REFERENCES analysts(address)
);

CREATE INDEX IF NOT EXISTS idx_insights_ticker ON insights(ticker);
CREATE INDEX IF NOT EXISTS idx_insights_module ON insights(module);
CREATE INDEX IF NOT EXISTS idx_insights_analyst ON insights(analyst_address);
CREATE INDEX IF NOT EXISTS idx_insights_submitted ON insights(submitted_at DESC);

CREATE TABLE IF NOT EXISTS edgar_filings (
  accession_number TEXT PRIMARY KEY,
  cik TEXT NOT NULL,
  form_type TEXT NOT NULL,
  filed_at TEXT NOT NULL,
  company_name TEXT NOT NULL,
  ticker TEXT,
  document_url TEXT NOT NULL,
  processed INTEGER NOT NULL DEFAULT 0,
  ingested_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_edgar_filed ON edgar_filings(filed_at DESC);
CREATE INDEX IF NOT EXISTS idx_edgar_form ON edgar_filings(form_type);
CREATE INDEX IF NOT EXISTS idx_edgar_ticker ON edgar_filings(ticker);

CREATE TABLE IF NOT EXISTS governance_scores (
  ticker TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  overall_grade TEXT NOT NULL,
  score REAL NOT NULL,
  board_independence REAL,
  ceo_pay_ratio REAL,
  audit_committee_score REAL,
  red_flag_count INTEGER NOT NULL DEFAULT 0,
  proxy_filing_date TEXT,
  meeting_date TEXT,
  analyst_consensus TEXT,
  key_issues TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS red_flags (
  id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  company_name TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence_urls TEXT NOT NULL DEFAULT '[]',
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolution_status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (resolution_status IN ('OPEN', 'RESOLVED', 'ESCALATED'))
);

CREATE INDEX IF NOT EXISTS idx_red_flags_ticker ON red_flags(ticker);
CREATE INDEX IF NOT EXISTS idx_red_flags_severity ON red_flags(severity);

CREATE TABLE IF NOT EXISTS institutional_flows (
  id TEXT PRIMARY KEY,
  institution_name TEXT NOT NULL,
  cik TEXT NOT NULL,
  ticker TEXT NOT NULL,
  period_of_report TEXT NOT NULL,
  previous_shares INTEGER,
  current_shares INTEGER NOT NULL,
  change_pct REAL,
  action TEXT NOT NULL CHECK (action IN ('NEW', 'INCREASED', 'DECREASED', 'EXITED')),
  estimated_value_usd REAL,
  filed_at TEXT NOT NULL,
  form_13f_accession TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_flows_ticker ON institutional_flows(ticker);
CREATE INDEX IF NOT EXISTS idx_flows_institution ON institutional_flows(institution_name);
CREATE INDEX IF NOT EXISTS idx_flows_filed ON institutional_flows(filed_at DESC);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  insight_id TEXT NOT NULL,
  buyer_address TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  amount_micro INTEGER NOT NULL,
  purchased_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (insight_id) REFERENCES insights(id)
);

CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,
  analyst_address TEXT NOT NULL,
  badge_type TEXT NOT NULL,
  earned_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT DEFAULT '{}',
  FOREIGN KEY (analyst_address) REFERENCES analysts(address)
);

CREATE TABLE IF NOT EXISTS agent_affiliates (
  agent_id TEXT PRIMARY KEY,
  name TEXT,
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  total_requests INTEGER NOT NULL DEFAULT 0,
  total_paid_requests INTEGER NOT NULL DEFAULT 0,
  total_fees_earned_micro INTEGER NOT NULL DEFAULT 0,
  last_seen TEXT
);
`;
