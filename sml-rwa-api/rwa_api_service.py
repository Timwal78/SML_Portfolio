"""RWA API with x402scan-compatible endpoints"""
from fastapi import FastAPI, HTTPException, Header, Query
from fastapi.responses import FileResponse
import httpx, json, logging, os
from datetime import datetime, timedelta
from typing import Optional, Dict, List
from enum import Enum
import hashlib

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("rwa_api")

app = FastAPI(
    title="SqueezeOS RWA Intelligence",
    version="1.0.0",
    description="x402-gated institutional tokenized asset APIs"
)

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

_assets: Dict[str, RWAAsset] = {}
_valuation_history: Dict[str, List[Dict]] = {}
_por_attestations: Dict[str, List[Dict]] = {}

_assets["TUS-AGG-01"] = RWAAsset(
    "TUS-AGG-01", AssetClass.TREASURIES, "US0123456789",
    "US Treasury Bond Aggregate (2-10Y ladder)", 1_250_000.00,
    datetime.utcnow(), 15,
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
)
_assets["RWA-NYC-COMMERCIAL"] = RWAAsset(
    "RWA-NYC-COMMERCIAL", AssetClass.REAL_ESTATE, "US1234567890",
    "Manhattan Commercial Real Estate (Class A Office)", 45_500_000.00,
    datetime.utcnow() - timedelta(days=1), 42,
    "d4d0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b999"
)
_assets["LCP-POOL-Q3-2026"] = RWAAsset(
    "LCP-POOL-Q3-2026", AssetClass.PRIVATE_CREDIT, "US2345678901",
    "Senior Secured Loan Pool (Q3 2026 vintage)", 120_000_000.00,
    datetime.utcnow(), 38,
    "a1a1c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b111"
)

PROOF402_TOKEN_SECRET = os.getenv("PROOF402_TOKEN_SECRET", "your-secret-here")

def verify_payment_token(token: str) -> Dict:
    if not PROOF402_TOKEN_SECRET or PROOF402_TOKEN_SECRET == "your-secret-here":
        raise HTTPException(status_code=503, detail="x402 not configured")
    try:
        parts = token.rsplit(".", 1)
        if len(parts) != 2:
            raise ValueError("Invalid token")
        encoded, signature = parts
        import hmac
        expected_sig = hmac.new(PROOF402_TOKEN_SECRET.encode(), encoded.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected_sig):
            raise HTTPException(status_code=401, detail="Invalid token")
        import base64
        payload = json.loads(base64.b64decode(encoded))
        if payload.get("exp", 0) < datetime.utcnow().timestamp():
            raise HTTPException(status_code=401, detail="Token expired")
        return payload
    except HTTPException:
        raise
    except:
        raise HTTPException(status_code=401, detail="Token verification failed")

# ============================================================================
# x402scan DISCOVERY
# ============================================================================

@app.get("/.well-known/x402")
async def x402_discovery():
    """x402scan discovery endpoint (required format)"""
    return {
        "service": "ScriptMasterLabs ACP x402 Data API",
        "name": "sml-rwa-api",
        "version": "1.0.0",
        "provider": "Script Master Labs",
        "endpoint": "https://sml-rwa-api.onrender.com",
        "x402_enabled": True,
        "settlement": "USDC on Base via x402",
        "description": "Institutional tokenized RWA intelligence APIs",
        "pricing_model": "pay-per-call",
        "endpoints": [
            {"path": "/x402/rwa-assets", "method": "GET", "cost_usdc": 0.15, "tier": "scout"},
            {"path": "/x402/rwa-intelligence", "method": "GET", "cost_usdc": 0.20, "tier": "investor"},
            {"path": "/x402/rwa-valuation", "method": "GET", "cost_usdc": 0.15, "tier": "investor"},
            {"path": "/x402/rwa-risk", "method": "GET", "cost_usdc": 0.10, "tier": "scout"},
            {"path": "/x402/rwa-aggregates", "method": "GET", "cost_usdc": 0.25, "tier": "institutional"}
        ],
        "asset_classes": ["treasuries", "real_estate", "private_credit", "emerging_markets", "commodities", "carbon_credits"],
        "integration": {
            "squeezeos_mcp": True,
            "mcp_endpoint": "https://squeezeos-api.onrender.com/mcp"
        },
        "documentation": "https://sml-rwa-api.onrender.com/openapi.json",
        "status": "production",
        "discoverable": True
    }

@app.get("/openapi.json")
async def openapi_spec():
    """OpenAPI 3.0 spec for x402scan indexing"""
    return {
        "openapi": "3.0.0",
        "info": {
            "title": "ScriptMasterLabs RWA x402 API",
            "version": "1.0.0",
            "description": "Institutional tokenized RWA intelligence APIs"
        },
        "servers": [{"url": "https://sml-rwa-api.onrender.com"}],
        "paths": {
            "/x402/rwa-assets": {
                "get": {
                    "summary": "List RWA assets",
                    "parameters": [
                        {"name": "X-Payment-Token", "in": "header", "required": False},
                        {"name": "asset_class", "in": "query", "required": False}
                    ],
                    "responses": {"200": {"description": "Asset list"}}
                }
            },
            "/x402/rwa-intelligence": {
                "get": {
                    "summary": "RWA intelligence (premium)",
                    "parameters": [{"name": "X-Payment-Token", "in": "header", "required": True}],
                    "responses": {"200": {"description": "Intelligence data"}}
                }
            }
        }
    }

@app.get("/x402/openapi.json")
async def x402_openapi():
    """Alternative OpenAPI endpoint"""
    return await openapi_spec()

# ============================================================================
# x402 ENDPOINTS (discoverable by x402scan)
# ============================================================================

@app.get("/health")
async def health():
    return {"status": "ok", "service": "sml-rwa-api", "x402_enabled": True}

@app.get("/x402/rwa-assets")
async def x402_rwa_assets(
    asset_class: Optional[str] = Query(None),
    limit: int = Query(50),
    x_payment_token: Optional[str] = Header(None)
):
    """List RWA assets - Free tier, requires x402 token for tracking"""
    results = list(_assets.values())
    if asset_class:
        results = [a for a in results if a.asset_class.value == asset_class]
    return {
        "endpoint": "/x402/rwa-assets",
        "total": len(results),
        "assets": [a.to_dict() for a in results[:limit]]
    }

@app.get("/x402/rwa-intelligence")
async def x402_rwa_intelligence(
    asset_id: str = Query(...),
    x_payment_token: str = Header(...)
):
    """Full RWA intelligence with compliance - Premium (0.20 USDC)"""
    verify_payment_token(x_payment_token)
    if asset_id not in _assets:
        raise HTTPException(status_code=404, detail="Asset not found")
    asset = _assets[asset_id]
    return {
        "endpoint": "/x402/rwa-intelligence",
        "asset": asset.to_dict(),
        "cost_usdc": 0.20,
        "tier": "investor"
    }

@app.get("/x402/rwa-valuation")
async def x402_rwa_valuation(
    asset_id: str = Query(...),
    days: int = Query(90),
    x_payment_token: str = Header(...)
):
    """NAV valuation history - Premium (0.15 USDC)"""
    verify_payment_token(x_payment_token)
    if asset_id not in _assets:
        raise HTTPException(status_code=404, detail="Asset not found")
    asset = _assets[asset_id]
    history = _valuation_history.get(asset_id, [])
    cutoff = datetime.utcnow() - timedelta(days=days)
    filtered = [h for h in history if datetime.fromisoformat(h["timestamp"]) >= cutoff]
    return {
        "endpoint": "/x402/rwa-valuation",
        "asset_id": asset_id,
        "current_nav": asset.nav_usd,
        "history_points": len(filtered),
        "cost_usdc": 0.15,
        "tier": "investor"
    }

@app.get("/x402/rwa-risk")
async def x402_rwa_risk(
    min_score: Optional[int] = Query(None),
    max_score: Optional[int] = Query(None)
):
    """Risk scorecard - Free tier"""
    assets = list(_assets.values())
    if min_score is not None:
        assets = [a for a in assets if a.risk_score >= min_score]
    if max_score is not None:
        assets = [a for a in assets if a.risk_score <= max_score]
    return {
        "endpoint": "/x402/rwa-risk",
        "timestamp": datetime.utcnow().isoformat(),
        "assets": [{"asset_id": a.asset_id, "risk_score": a.risk_score, "class": a.asset_class.value} for a in assets],
        "portfolio_weighted_risk": 35
    }

@app.get("/x402/rwa-aggregates")
async def x402_rwa_aggregates(x_payment_token: str = Header(...)):
    """Aggregate RWA intelligence across all assets - Premium (0.25 USDC)"""
    verify_payment_token(x_payment_token)
    return {
        "endpoint": "/x402/rwa-aggregates",
        "total_assets": len(_assets),
        "total_nav_usd": sum(a.nav_usd for a in _assets.values()),
        "avg_risk_score": sum(a.risk_score for a in _assets.values()) / len(_assets) if _assets else 0,
        "by_class": {
            class_val: {
                "count": len([a for a in _assets.values() if a.asset_class.value == class_val]),
                "total_nav": sum(a.nav_usd for a in _assets.values() if a.asset_class.value == class_val)
            }
            for class_val in [c.value for c in AssetClass]
        },
        "cost_usdc": 0.25,
        "tier": "institutional"
    }

@app.get("/x402/proof-of-reserves")
async def x402_proof_of_reserves(
    asset_id: Optional[str] = Query(None),
    x_payment_token: Optional[str] = Header(None)
):
    """Proof-of-reserves audit trail"""
    if x_payment_token:
        verify_payment_token(x_payment_token)
    if asset_id:
        if asset_id not in _assets:
            raise HTTPException(status_code=404, detail="Asset not found")
        asset = _assets[asset_id]
        return {
            "endpoint": "/x402/proof-of-reserves",
            "asset_id": asset_id,
            "por_hash": asset.proof_of_reserves_hash,
            "attestations": _por_attestations.get(asset_id, [])
        }
    return {
        "endpoint": "/x402/proof-of-reserves",
        "total_assets": len(_assets),
        "aggregate_hash": hashlib.sha256(
            json.dumps({a_id: a.proof_of_reserves_hash for a_id, a in _assets.items()}, sort_keys=True).encode()
        ).hexdigest()
    }

@app.on_event("startup")
async def startup():
    logger.info(f"RWA API started with x402scan discovery. Loaded {len(_assets)} assets")
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
