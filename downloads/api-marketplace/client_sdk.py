#!/usr/bin/env python3
"""Script Master Labs — mcp-x402 Python client
Generated 2026-07-29 from live OpenAPI (77 paths)
SAM UEI G24VZA4RLMK3 · CAGE 21U51 · SDVOSB
Base: https://mcp-x402.onrender.com
x402 payTo: 0x72330994f379a71542e7bd5a4cf99a9d9743f4aa (eip155:8453 USDC)
"""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional

DEFAULT_BASE = "https://mcp-x402.onrender.com"
PAY_TO = "0x72330994f379a71542e7bd5a4cf99a9d9743f4aa"
SAM_UEI = "G24VZA4RLMK3"
CAGE = "21U51"


class PaymentRequired(Exception):
    def __init__(self, challenge: Any):
        super().__init__("Payment Required (x402)")
        self.challenge = challenge
        self.status = 402


class SmlX402Client:
    def __init__(
        self,
        base_url: str = DEFAULT_BASE,
        api_key: Optional[str] = None,
        payment_header: Optional[str] = None,
        timeout: float = 30.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.payment_header = payment_header
        self.timeout = timeout

    def request(self, method: str, path: str, query: Optional[Dict[str, str]] = None) -> Any:
        if not path.startswith("/"):
            path = "/" + path
        url = self.base_url + path
        if query:
            url += "?" + urllib.parse.urlencode(query)
        headers = {
            "Accept": "application/json",
            "User-Agent": "sml-x402-sdk-py/1.0",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if self.payment_header:
            headers["X-PAYMENT"] = self.payment_header
            headers["PAYMENT-SIGNATURE"] = self.payment_header
        req = urllib.request.Request(url, headers=headers, method=method.upper())
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read()
                ct = resp.headers.get("Content-Type", "")
                if "application/json" in ct:
                    return json.loads(raw.decode() or "null")
                return raw.decode()
        except urllib.error.HTTPError as e:
            body = e.read()
            if e.code == 402:
                try:
                    challenge = json.loads(body.decode() or "{}")
                except Exception:
                    challenge = body.decode(errors="ignore")
                raise PaymentRequired(challenge) from e
            raise RuntimeError(f"{method} {path} → {e.code} {body[:300]!r}") from e

    def get_openapi(self) -> dict:
        return self.request("GET", "/openapi.json")

    def get_catalog(self) -> dict:
        return self.request("GET", "/.well-known/x402")

    def health(self) -> dict:
        return self.request("GET", "/health")

    def stats(self) -> dict:
        return self.request("GET", "/x402/stats")

    def snack(self, path: str, query: Optional[Dict[str, str]] = None) -> Any:
        """GET a paid snack path (e.g. /x402/gas-tracker)."""
        return self.request("GET", path, query=query)


if __name__ == "__main__":
    c = SmlX402Client()
    print(json.dumps(c.health(), indent=2))
    oa = c.get_openapi()
    print("paths", len(oa.get("paths") or {}), "uei", SAM_UEI, "cage", CAGE)
