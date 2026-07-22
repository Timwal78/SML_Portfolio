"""RWA API with x402scan discovery"""
from fastapi import FastAPI, HTTPException, Header, Query
import httpx, json, logging
from datetime import datetime, timedelta
from typing import Optional, Dict, List
from enum import Enum
import hashlib

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("rwa_api")

app = FastAPI(title="SqueezeOS RWA Intelligence", version="1.0.0")

# Asset classes
class AssetClass(str, Enum):
    TREASURIES = "treasuries"
    REAL_ESTATE = "real_estate"
    PRIVATE_CREDIT = "private_credit"
    EMERGING_MARKETS = "emerging_markets"
    COMMODITIES = "commodities"
    CARBON_CREDITS = "carbon_credits"

class RWAAsset:
    def __init__(self, asset_id: str, asset_class: AssetClass, isin: str,
                 description: str, nav_usd: float, nav_timestamp: datetime,
                 risk_score: int, proof_of_reserves_hash: str):
        self.asset_id = asset_id
        self.asset_class = asset_class
        self.isin = isin
        self.description = description
        self.nav_usd = nav_usd
        self.nav_timestamp = nav_timestamp
        self.risk_score = risk_score
        self.proof_of_reserves_hash = proof_of_reserves_hash
        self.created_at = datetime.utcnow()

    def to_dict(self):
        return {
            "asset_id": self.asset_id,
            "asset_class": self.asset_class.value,
            "isin": self.isin,
            "description": self.description,
            "nav_usd": self.nav_usd,
            "nav_timestamp": self.nav_timestamp.isoformat(),
            "risk_score": self.risk_score,
            "proof_of_reserves_hash": self.proof_of_reserves_hash,
            "created_at": self.created_at.isoformat()
        }

# Seed assets
_assets: Dict[str, RWAAsset] = {}
_valuation_history: Dict[str, List[Dict]] = {}
_por_attestations: Dict[str, List[Dict]] = {}

_assets["TUS-AGG-01"] = RWAAsset(
    asset_id="TUS-AGG-01", asset_class=AssetClass.TREASURIES, isin="US0123456789",
    description="US Treasury Bond Aggregate (2-10Y ladder)", nav_usd=1_250_000.00,
    nav_timestamp=datetime.utcnow(), risk_score=15,
    proof_of_reserves_hash="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
)
_assets["RWA-NYC-COMMERCIAL"] = RWAAsset(
    asset_id="RWA-NYC-COMMERCIAL", asset_class=AssetClass.REAL_ESTATE, isin="US1234567890",
    description="Manhattan Commercial Real Estate (Class A Office)", nav_usd=45_500_000.00,
    nav_timestamp=datetime.utcnow() - timedelta(days=1), risk_score=42,
    proof_of_reserves_hash="d4d0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b999"
)
_assets["LCP-POOL-Q3-2026"] = RWAAsset(
    asset_id="LCP-POOL-Q3-2026", asset_class=AssetClass.PRIVATE_CREDIT, isin="US2345678901",
    description="Senior Secured Loan Pool (Q3 2026 vintage)", nav_usd=120_000_000.00,
    nav_timestamp=datetime.utcnow(), risk_score=38,
    proof_of_reserves_hash="a1a1c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b111"
)

PROOF402_TOKEN_SECRET = "your-secret-here"

def verify_payment_token(token: str) -> Dict:
    if not PROOF402_TOKEN_SECRET:
        raise HTTPException(status_code=503, detail="Payment verification not configured")
    try:
        parts = token.rsplit(".", 1)
        if len(parts) != 2:
            raise ValueError("Invalid token format")
        encoded, signature = parts
        import hmac
        expected_sig = hmac.new(PROOF402_TOKEN_SECRET.encode(), encoded.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected_sig):
            raise HTTPException(status_code=401, detail="Invalid payment token")
        import base64
        payload = json.loads(base64.b64decode(encoded))
        if payload.get("exp", 0) < datetime.utcnow().timestamp():
            raise HTTPException(status_code=401, detail="Payment token expired")
        return payload
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Token verification failed: {str(e)}")

async def fetch_squeezeos_compliance(isin: str) -> Dict:
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"https://squeezeos-api.onrender.com/api/preview/{isin}",
                                   headers={"User-Agent": "RWA-API/1.0"})
            if resp.status_code == 200:
                return resp.json()
    except Exception as e:
        logger.warning(f"SqueezeOS compliance fetch failed for {isin}: {e}")
    return {"status": "unavailable"}

# ============================================================================
# DISCOVERY ENDPOINTS (for x402scan)
# ============================================================================

@app.get("/.well-known/x402-registry.json")
async def x402_registry():
    """x402scan discovery endpoint"""
    return {
        "service": "SqueezeOS RWA Intelligence API",
        "version": "1.0.0",
        "endpoint": "https://sml-rwa-api.onrender.com",
        "x402_enabled": True,
        "description": "Institutional tokenized asset intelligence",
        "pricing": {
            "tier_0_scout": {"cost_rlusd": 0, "endpoints": ["/assets", "/risk-scores"]},
            "tier_1_investor": {"cost_rlusd_per_call": 0.15, "endpoints": ["/assets/{id}/valuation"]},
            "tier_2_institutional": {"cost_rlusd_per_call": 0.20, "endpoints": ["/proof-of-reserves"]}
        },
        "asset_classes": ["treasuries", "real_estate", "private_credit", "emerging_markets", "commodities", "carbon_credits"],
        "integration": {
            "squeezeos_mcp": True,
            "mcp_tools": ["rwa_scan", "rwa_valuation", "rwa_proof_of_reserves"],
            "mcp_endpoint": "https://squeezeos-api.onrender.com/mcp"
        },
        "status": "production"
    }

@app.get("/.well-known/mcp.json")
async def mcp_discovery():
    """MCP server discovery"""
    return {
        "name": "SqueezeOS RWA Intelligence",
        "version": "1.0.0",
        "description": "RWA asset intelligence (exposed via SqueezeOS MCP)",
        "tools": 3
    }

# ============================================================================
# REST ENDPOINTS
# ============================================================================

@app.get("/health")
async def health():
    return {"status": "ok", "service": "sml-rwa-api"}

@app.get("/assets", tags=["Browse"])
async def list_assets(
    asset_class: Optional[AssetClass] = Query(None),
    min_risk_score: Optional[int] = Query(None),
    max_risk_score: Optional[int] = Query(None),
    limit: int = Query(50)
):
    results = list(_assets.values())
    if asset_class:
        results = [a for a in results if a.asset_class == asset_class]
    if min_risk_score is not None:
        results = [a for a in results if a.risk_score >= min_risk_score]
    if max_risk_score is not None:
        results = [a for a in results if a.risk_score <= max_risk_score]
    return {"total": len(results), "assets": [a.to_dict() for a in results[:limit]]}

@app.get("/assets/{asset_id}", tags=["Browse"])
async def get_asset(asset_id: str):
    if asset_id not in _assets:
        raise HTTPException(status_code=404, detail="Asset not found")
    asset = _assets[asset_id]
    detail = asset.to_dict()
    compliance = await fetch_squeezeos_compliance(asset.isin)
    detail["squeezeos_compliance"] = compliance
    return detail

@app.get("/assets/{asset_id}/valuation", tags=["Valuations"])
async def get_valuation_history(
    asset_id: str, days: int = Query(90), payment_token: Optional[str] = Header(None)
):
    if asset_id not in _assets:
        raise HTTPException(status_code=404, detail="Asset not found")
    if payment_token:
        verify_payment_token(payment_token)
    asset = _assets[asset_id]
    history = _valuation_history.get(asset_id, [])
    cutoff = datetime.utcnow() - timedelta(days=days)
    filtered = [h for h in history if datetime.fromisoformat(h["timestamp"]) >= cutoff]
    return {
        "asset_id": asset_id,
        "asset_class": asset.asset_class.value,
        "current_nav": asset.nav_usd,
        "history_points": len(filtered),
        "history": sorted(filtered, key=lambda x: x["timestamp"])
    }

@app.get("/risk-scores", tags=["Risk"])
async def get_risk_scores():
    return {
        "timestamp": datetime.utcnow().isoformat(),
        "assets": [{"asset_id": a.asset_id, "risk_score": a.risk_score, "asset_class": a.asset_class.value} for a in _assets.values()],
        "portfolio_weighted_risk": 35
    }

@app.get("/proof-of-reserves", tags=["Compliance"])
async def get_proof_of_reserves(asset_id: Optional[str] = Query(None), payment_token: Optional[str] = Header(None)):
    if payment_token:
        verify_payment_token(payment_token)
    if asset_id:
        if asset_id not in _assets:
            raise HTTPException(status_code=404, detail="Asset not found")
        attestations = _por_attestations.get(asset_id, [])
        asset = _assets[asset_id]
        return {"asset_id": asset_id, "current_por_hash": asset.proof_of_reserves_hash, "attestations": attestations}
    return {
        "total_assets": len(_assets),
        "aggregate_por_hash": hashlib.sha256(json.dumps({a_id: a.proof_of_reserves_hash for a_id, a in _assets.items()}, sort_keys=True).encode()).hexdigest(),
        "last_updated": datetime.utcnow().isoformat()
    }

@app.on_event("startup")
async def startup_event():
    logger.info(f"RWA API starting... Loaded {len(_assets)} seed assets")
    for asset_id, asset in _assets.items():
        history = []
        base_nav = asset.nav_usd
        for i in range(90):
            ts = datetime.utcnow() - timedelta(days=90-i)
            nav = base_nav * (1 + (i * 0.0001))
            history.append({"timestamp": ts.isoformat(), "nav_usd": nav, "source": "simulated"})
        _valuation_history[asset_id] = history

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8183)
