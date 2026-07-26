"""
ScriptMasterLabs (SML) Leviathan Matrix API - Official Python SDK
Quant & Institutional Trader Integration
"""

import requests
import time

class LeviathanClient:
    """
    Client for accessing SML Leviathan Institutional Short-Squeeze Signal API.
    Supports Base, Polygon, and Solana payment tokens.
    """
    def __init__(self, api_base="https://sml-x402-signal-api.onrender.com", api_token=None):
        self.api_base = api_base.rstrip("/")
        self.api_token = api_token

    def get_shadow_signal(self, ticker="GME"):
        """
        Fetch 65-minute delayed Shadow tier signal (Free for backtesting & evaluation).
        """
        url = f"{self.api_base}/matrix/{ticker.upper()}/delayed"
        res = requests.get(url)
        if res.status_code == 200:
            return res.json()
        res.raise_for_status()

    def get_live_signal(self, ticker="GME", access_token=None):
        """
        Fetch real-time institutional squeeze signal using 30-day access token.
        """
        token = access_token or self.api_token
        if not token:
            raise ValueError("Live real-time feed requires a 30-day token. Buy via client.buy_token('standard')")

        url = f"{self.api_base}/matrix/{ticker.upper()}/live"
        headers = {"X-Access-Token": token}
        res = requests.get(url, headers=headers)
        if res.status_code == 200:
            return res.json()
        res.raise_for_status()

    def check_loyalty_credits(self, wallet_address):
        """
        Check accrued loyalty credits and fee discount status.
        """
        url = f"{self.api_base}/loyalty/{wallet_address}"
        res = requests.get(url)
        if res.status_code == 200:
            return res.json()
        res.raise_for_status()

    def get_affiliate_stats(self, wallet_address):
        """
        Check 15% revenue share affiliate earnings.
        """
        url = f"{self.api_base}/affiliate/{wallet_address}"
        res = requests.get(url)
        if res.status_code == 200:
            return res.json()
        res.raise_for_status()

if __name__ == "__main__":
    # Quick Start Demo
    print("Initializing ScriptMasterLabs Leviathan SDK...")
    client = LeviathanClient()
    try:
        signal = client.get_shadow_signal("GME")
        print(f"Shadow Signal Received: {signal}")
    except Exception as e:
        print(f"Shadow feed response: {e}")
