#!/usr/bin/env python3
"""
Crawltoll VAPL Integration Plugin
===================================
Issues a VAPL InteractionCredential (type=CrawltollFetch) for every
successful toll-gated crawl. Attaches the VC to the crawl result so
downstream agents can verify provenance without trusting the crawler.

Usage in Crawltoll's existing fetch pipeline:

    from crawltoll_plugin import CrawltollVAPLPlugin

    plugin = CrawltollVAPLPlugin(soul=load_or_create_soul())

    # Wrap your existing fetch result:
    result = plugin.wrap(url=url, raw_result=raw_result, cost_rlusd=cost)
    # result now contains both the data and a verifiable VC

The VC can be verified by any agent:

    from vapl import verify_vc
    verified = verify_vc(result["vapl_vc"], trusted_issuers=[known_crawler_did])
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any

try:
    from vapl import (
        ProvenanceSoul, generate_soul,
        issue_interaction_vc, verify_vc,
    )
except ImportError as exc:
    raise ImportError(
        "Install vapl-py first: pip install vapl-py"
    ) from exc


@dataclass
class CrawltollFetchResult:
    """Wrapped crawl result with attached VAPL provenance."""
    url: str
    content: Any
    fetched_at: str
    cost_rlusd: float
    vapl_vc: dict[str, Any]
    crawler_did: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "url": self.url,
            "content": self.content,
            "fetched_at": self.fetched_at,
            "cost_rlusd": self.cost_rlusd,
            "vapl_vc": self.vapl_vc,
            "crawler_did": self.crawler_did,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "CrawltollFetchResult":
        return cls(
            url=d["url"],
            content=d["content"],
            fetched_at=d["fetched_at"],
            cost_rlusd=d["cost_rlusd"],
            vapl_vc=d["vapl_vc"],
            crawler_did=d["crawler_did"],
        )


class CrawltollVAPLPlugin:
    """
    Wraps a Crawltoll fetch result with a VAPL InteractionCredential.

    Args:
        soul: The crawler's persistent ProvenanceSoul identity.
    """

    def __init__(self, soul: ProvenanceSoul) -> None:
        self._soul = soul

    @property
    def did(self) -> str:
        return self._soul.did

    def wrap(
        self,
        url: str,
        raw_result: Any,
        cost_rlusd: float = 0.0,
        requester_did: str | None = None,
        outcome: str = "success",
    ) -> CrawltollFetchResult:
        """
        Issue a CrawltollFetch VC and attach it to the result.

        Args:
            url:           The crawled URL.
            raw_result:    The raw crawl payload (any JSON-serialisable value).
            cost_rlusd:    RLUSD toll paid for this fetch.
            requester_did: DID of the agent that requested the crawl.
                           If omitted, subject defaults to the crawler's own DID.
            outcome:       'success' | 'partial' | 'failed'

        Returns:
            CrawltollFetchResult with an embedded, verifiable VAPL VC.
        """
        from datetime import datetime, timezone

        fetched_at = datetime.now(timezone.utc).isoformat()
        subject_did = requester_did if requester_did else self._soul.did

        vc = issue_interaction_vc(
            soul=self._soul,
            subject_did=subject_did,
            interaction_type="CrawltollFetch",
            endpoint_id=url,
            provider_did=self._soul.did,
            outcome=outcome,
            metadata={
                "url": url,
                "cost_rlusd": cost_rlusd,
                "fetched_at": fetched_at,
                "content_hash": _sha256_hex(
                    json.dumps(raw_result, sort_keys=True).encode()
                ),
            },
        )

        return CrawltollFetchResult(
            url=url,
            content=raw_result,
            fetched_at=fetched_at,
            cost_rlusd=cost_rlusd,
            vapl_vc=vc,
            crawler_did=self._soul.did,
        )

    def verify_result(
        self,
        result: CrawltollFetchResult,
        trusted_crawlers: list[str] | None = None,
    ) -> bool:
        """
        Verify that a CrawltollFetchResult's VC is valid and
        optionally restrict to a set of trusted crawler DIDs.
        """
        is_valid, _, reason = verify_vc(
            result.vapl_vc,
            trusted_issuers=trusted_crawlers,
        )
        if not is_valid:
            import logging
            logging.getLogger("crawltoll_vapl").warning(
                "VC verification failed: %s", reason
            )
        return is_valid


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _sha256_hex(data: bytes) -> str:
    import hashlib
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------
# Demo
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import json

    soul = generate_soul()
    plugin = CrawltollVAPLPlugin(soul=soul)
    print(f"Crawler DID: {soul.did}")

    # Simulate a crawl result
    mock_content = {
        "title": "ScriptMasterLabs — Institutional AI Trading",
        "status": 200,
        "word_count": 1420,
    }

    result = plugin.wrap(
        url="https://www.scriptmasterlabs.com",
        raw_result=mock_content,
        cost_rlusd=0.001,
    )

    print("\n=== Crawl Result ===")
    d = result.to_dict()
    d["vapl_vc"] = "<VC omitted for brevity>"
    print(json.dumps(d, indent=2))

    valid = plugin.verify_result(result)
    print(f"\nVC verification: {'PASS' if valid else 'FAIL'}")

    # Verify with wrong trusted issuer
    fake_did = "did:key:z6MkfQ2D8kBqsmcVbp1mCMDCQ1ZpEvFM8JjFpKdCXSFX4abc"
    rejected = plugin.verify_result(result, trusted_crawlers=[fake_did])
    print(f"Untrusted issuer rejection: {'PASS (correctly rejected)' if not rejected else 'FAIL'}")
