-- xAAP D1 Database Schema
-- Run: wrangler d1 execute xaap-db --file=./worker/schema.sql

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────
-- AUDITORS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auditors (
  address          TEXT PRIMARY KEY,  -- EVM wallet address (lowercase)
  ens_name         TEXT,
  display_name     TEXT,
  bio              TEXT,
  avatar_url       TEXT,
  tier             TEXT NOT NULL DEFAULT 'CITIZEN',  -- CITIZEN|DETECTIVE|INVESTIGATOR|AUDITOR|GRAND_INQUISITOR
  reputation_score REAL NOT NULL DEFAULT 0.0,        -- 0-100
  accuracy_rate    REAL NOT NULL DEFAULT 0.0,        -- 0-1
  total_findings   INTEGER NOT NULL DEFAULT 0,
  validated_findings INTEGER NOT NULL DEFAULT 0,
  invalidated_findings INTEGER NOT NULL DEFAULT 0,
  streak_days      INTEGER NOT NULL DEFAULT 0,
  last_active      INTEGER NOT NULL DEFAULT 0,       -- unix timestamp
  referrer_address TEXT,
  total_earned_usdc TEXT NOT NULL DEFAULT '0',       -- USDC in smallest units
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_auditors_tier ON auditors(tier);
CREATE INDEX IF NOT EXISTS idx_auditors_reputation ON auditors(reputation_score DESC);

-- ─────────────────────────────────────────
-- TICKERS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickers (
  symbol           TEXT PRIMARY KEY,  -- e.g. AAPL
  company_name     TEXT NOT NULL,
  cik              TEXT,               -- SEC CIK number
  sector           TEXT,
  market_cap_tier  TEXT,               -- MEGA|LARGE|MID|SMALL|MICRO
  health_grade     TEXT NOT NULL DEFAULT 'PENDING', -- A+|A|B|C|D|F|PENDING
  health_score     REAL NOT NULL DEFAULT 0.0,
  red_flag_count   INTEGER NOT NULL DEFAULT 0,
  severe_flag_count INTEGER NOT NULL DEFAULT 0,
  auditor_count    INTEGER NOT NULL DEFAULT 0,
  last_filing_date INTEGER,
  last_scored_at   INTEGER,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_tickers_grade ON tickers(health_grade);
CREATE INDEX IF NOT EXISTS idx_tickers_flags ON tickers(red_flag_count DESC);

-- ─────────────────────────────────────────
-- FORENSIC FINDINGS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS findings (
  id               TEXT PRIMARY KEY,   -- UUID
  ticker           TEXT NOT NULL REFERENCES tickers(symbol),
  auditor_address  TEXT NOT NULL REFERENCES auditors(address),
  title            TEXT NOT NULL,
  summary          TEXT NOT NULL,      -- Public preview (free)
  full_thesis      TEXT,               -- Full content (x402 gated, stored encrypted in R2)
  evidence_cid     TEXT,               -- IPFS CID of evidence packet
  evidence_hash    TEXT,               -- keccak256 of evidence (on-chain proof)
  severity         TEXT NOT NULL,      -- LOW|MEDIUM|HIGH|CRITICAL
  category         TEXT NOT NULL,      -- RELATED_PARTY|AUDITOR_CHANGE|GOING_CONCERN|REVENUE_RECOGNITION|EXECUTIVE_COMP|SUBSIDIARY|INSIDER_TRADING|OTHER
  price_usdc       TEXT NOT NULL DEFAULT '1000000', -- Price in USDC (6 decimals), default $1.00
  status           TEXT NOT NULL DEFAULT 'PENDING', -- PENDING|VALIDATED|INVALIDATED|EXPIRED
  validation_score REAL,               -- Set when validated
  validation_note  TEXT,
  validated_at     INTEGER,
  filing_accession TEXT,               -- SEC accession number
  filing_type      TEXT,               -- 10-K|10-Q|8-K|13F|13D|Form4|DEF14A
  is_free_preview  INTEGER NOT NULL DEFAULT 0, -- 1 if in free top-3
  access_count     INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_findings_ticker ON findings(ticker);
CREATE INDEX IF NOT EXISTS idx_findings_auditor ON findings(auditor_address);
CREATE INDEX IF NOT EXISTS idx_findings_status ON findings(status);
CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);
CREATE INDEX IF NOT EXISTS idx_findings_created ON findings(created_at DESC);

-- ─────────────────────────────────────────
-- EDGAR FILINGS CACHE
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS filings (
  accession_number TEXT PRIMARY KEY,
  cik              TEXT NOT NULL,
  ticker           TEXT,
  form_type        TEXT NOT NULL,
  filing_date      INTEGER NOT NULL,
  period_of_report INTEGER,
  primary_document TEXT,
  processing_status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING|PROCESSING|COMPLETE|ERROR
  red_flags_json   TEXT,               -- JSON array of detected red flags
  forensic_score   REAL,
  processed_at     INTEGER,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_filings_cik ON filings(cik);
CREATE INDEX IF NOT EXISTS idx_filings_ticker ON filings(ticker);
CREATE INDEX IF NOT EXISTS idx_filings_date ON filings(filing_date DESC);
CREATE INDEX IF NOT EXISTS idx_filings_status ON filings(processing_status);

-- ─────────────────────────────────────────
-- FINDING PURCHASES (payment ledger)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchases (
  id               TEXT PRIMARY KEY,
  finding_id       TEXT NOT NULL REFERENCES findings(id),
  buyer_address    TEXT NOT NULL,
  amount_usdc      TEXT NOT NULL,
  auditor_payout   TEXT NOT NULL,       -- 70%
  juror_payout     TEXT NOT NULL,       -- 20%
  treasury_payout  TEXT NOT NULL,       -- 5%
  agent_payout     TEXT,                -- 15% of protocol fee if agent referral
  agent_id         TEXT,
  tx_hash          TEXT,
  payment_proof    TEXT,                -- x402 payment proof
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_purchases_finding ON purchases(finding_id);
CREATE INDEX IF NOT EXISTS idx_purchases_buyer ON purchases(buyer_address);
CREATE INDEX IF NOT EXISTS idx_purchases_agent ON purchases(agent_id);

-- ─────────────────────────────────────────
-- JUROR PANEL
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jurors (
  id               TEXT PRIMARY KEY,
  finding_id       TEXT NOT NULL REFERENCES findings(id),
  juror_address    TEXT NOT NULL,
  vote             TEXT,                -- VALIDATE|INVALIDATE|ABSTAIN
  rationale        TEXT,
  staked_usdc      TEXT NOT NULL DEFAULT '0',
  voted_at         INTEGER,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jurors_unique ON jurors(finding_id, juror_address);

-- ─────────────────────────────────────────
-- REPUTATION EVENTS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reputation_events (
  id               TEXT PRIMARY KEY,
  auditor_address  TEXT NOT NULL REFERENCES auditors(address),
  event_type       TEXT NOT NULL,   -- FINDING_VALIDATED|FINDING_INVALIDATED|STREAK_BONUS|REFERRAL_BONUS|JUROR_CORRECT|JUROR_INCORRECT
  delta            REAL NOT NULL,   -- reputation score change
  multiplier       REAL NOT NULL DEFAULT 1.0,
  note             TEXT,
  related_id       TEXT,            -- finding_id or other reference
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_rep_events_auditor ON reputation_events(auditor_address);

-- ─────────────────────────────────────────
-- ACHIEVEMENTS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS achievements (
  id               TEXT PRIMARY KEY,
  auditor_address  TEXT NOT NULL REFERENCES auditors(address),
  badge_id         TEXT NOT NULL,   -- FIRST_BLOOD|ENRONS_REVENGE|GHOST_HUNTER|SATELLITE_SLEUTH|WAYBACK_WARRIOR|...
  metadata_json    TEXT,
  earned_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_achievements_unique ON achievements(auditor_address, badge_id);

-- ─────────────────────────────────────────
-- AI AGENT REGISTRY
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agents (
  agent_id         TEXT PRIMARY KEY,  -- X-AGENT-ID header value
  name             TEXT NOT NULL,
  description      TEXT,
  owner_address    TEXT,
  total_referrals  INTEGER NOT NULL DEFAULT 0,
  total_volume_usdc TEXT NOT NULL DEFAULT '0',
  lifetime_payout_usdc TEXT NOT NULL DEFAULT '0',
  registered_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  last_active      INTEGER NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────
-- VERIFIED REVIEWS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id               TEXT PRIMARY KEY,
  finding_id       TEXT NOT NULL REFERENCES findings(id),
  reviewer_address TEXT NOT NULL,
  purchase_id      TEXT NOT NULL REFERENCES purchases(id),
  rating           INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  content          TEXT,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_unique ON reviews(finding_id, reviewer_address);

-- ─────────────────────────────────────────
-- VERDICT LOG (company restatements / SEC actions)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS verdicts (
  id               TEXT PRIMARY KEY,
  ticker           TEXT NOT NULL,
  verdict_type     TEXT NOT NULL,  -- SEC_CHARGE|RESTATEMENT|COLLAPSE|MANAGEMENT_CHANGE
  description      TEXT NOT NULL,
  source_url       TEXT,
  announced_at     INTEGER NOT NULL,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_verdicts_ticker ON verdicts(ticker);
