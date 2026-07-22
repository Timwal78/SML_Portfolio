-- RWA API PostgreSQL Schema
-- Handles institutional tokenized asset data with timeseries tracking

CREATE TABLE IF NOT EXISTS rwa_assets (
    asset_id VARCHAR(32) PRIMARY KEY,
    asset_class VARCHAR(50) NOT NULL,
    isin VARCHAR(12) UNIQUE NOT NULL,
    description TEXT NOT NULL,
    nav_usd NUMERIC(18, 2) NOT NULL,
    nav_timestamp TIMESTAMP NOT NULL,
    risk_score INT NOT NULL,
    proof_of_reserves_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_asset_class (asset_class),
    INDEX idx_risk_score (risk_score),
    INDEX idx_isin (isin)
);

CREATE TABLE IF NOT EXISTS rwa_valuations (
    id BIGSERIAL PRIMARY KEY,
    asset_id VARCHAR(32) NOT NULL REFERENCES rwa_assets(asset_id) ON DELETE CASCADE,
    nav_usd NUMERIC(18, 2) NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    source VARCHAR(50),
    INDEX idx_asset_timestamp (asset_id, timestamp DESC)
);

CREATE TABLE IF NOT EXISTS rwa_por_attestations (
    id BIGSERIAL PRIMARY KEY,
    asset_id VARCHAR(32) NOT NULL REFERENCES rwa_assets(asset_id) ON DELETE CASCADE,
    por_hash VARCHAR(64) NOT NULL,
    attestation_date TIMESTAMP NOT NULL,
    attestor VARCHAR(255),
    verification_url TEXT,
    notes TEXT,
    INDEX idx_asset_date (asset_id, attestation_date DESC)
);

CREATE TABLE IF NOT EXISTS rwa_compliance_records (
    id BIGSERIAL PRIMARY KEY,
    isin VARCHAR(12) UNIQUE NOT NULL REFERENCES rwa_assets(isin) ON DELETE CASCADE,
    compliance_data JSONB,
    source VARCHAR(50),
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_isin (isin)
);

CREATE TABLE IF NOT EXISTS rwa_api_calls (
    id BIGSERIAL PRIMARY KEY,
    endpoint VARCHAR(255) NOT NULL,
    caller_wallet VARCHAR(255),
    payment_token_hash VARCHAR(64),
    cost_rlusd NUMERIC(10, 4),
    status_code INT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_caller_date (caller_wallet, timestamp DESC),
    INDEX idx_endpoint_date (endpoint, timestamp DESC)
);

CREATE TABLE IF NOT EXISTS rwa_portfolio_snapshots (
    id BIGSERIAL PRIMARY KEY,
    portfolio_name VARCHAR(255) NOT NULL,
    total_nav_usd NUMERIC(18, 2),
    weighted_risk_score NUMERIC(5, 2),
    asset_breakdown JSONB,
    snapshot_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_portfolio_date (portfolio_name, snapshot_date DESC)
);
