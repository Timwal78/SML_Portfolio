"""NATS v2.0 agent swarm — 20 heterogeneous agents. See base_agent.py for the shared interface."""

from src.agents.base_agent import AgentMetadata, BaseAgent

from src.agents.agent_01_momentum_hunter import MomentumHunter
from src.agents.agent_02_mean_reversion_sniper import MeanReversionSniper
from src.agents.agent_03_vol_regime_detector import VolRegimeDetector
from src.agents.agent_04_cross_asset_arb import CrossAssetArb
from src.agents.agent_05_dispersion_trader import DispersionTrader
from src.agents.agent_06_crypto_lead_lag import CryptoLeadLag
from src.agents.agent_07_seasonality_expert import SeasonalityExpert
from src.agents.agent_08_bollinger_bouncer import BollingerBouncer
from src.agents.agent_09_volume_confirmer import VolumeConfirmer
from src.agents.agent_10_trend_follower import TrendFollower
from src.agents.agent_11_fear_greed_contrarian import FearGreedContrarian
from src.agents.agent_12_macro_rotator import MacroRotator
from src.agents.agent_13_earnings_edge import EarningsEdge
from src.agents.agent_14_options_flow_reader import OptionsFlowReader
from src.agents.agent_15_stat_arb import StatArb
from src.agents.agent_16_econ_surprise_trader import EconSurpriseTrader
from src.agents.agent_17_order_flow_imbalance import OrderFlowImbalance
from src.agents.agent_18_sentiment_velocity import SentimentVelocity
from src.agents.agent_19_credit_spread_reader import CreditSpreadReader
from src.agents.agent_20_shadow_flow_hunter import ShadowFlowHunter

__all__ = [
    "AgentMetadata",
    "BaseAgent",
    "MomentumHunter",
    "MeanReversionSniper",
    "VolRegimeDetector",
    "CrossAssetArb",
    "DispersionTrader",
    "CryptoLeadLag",
    "SeasonalityExpert",
    "BollingerBouncer",
    "VolumeConfirmer",
    "TrendFollower",
    "FearGreedContrarian",
    "MacroRotator",
    "EarningsEdge",
    "OptionsFlowReader",
    "StatArb",
    "EconSurpriseTrader",
    "OrderFlowImbalance",
    "SentimentVelocity",
    "CreditSpreadReader",
    "ShadowFlowHunter",
]
