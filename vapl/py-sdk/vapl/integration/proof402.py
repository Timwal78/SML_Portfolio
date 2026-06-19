"""Drop-in middleware for 402Proof / SqueezeOS VC issuance."""
from __future__ import annotations
import hashlib
from typing import Optional

from ..identity import ProvenanceSoul
from ..credentials import issue_interaction_vc

ENDPOINT_TYPE_MAP: dict[str, str] = {
    '/api/council': 'CouncilVerdict',
    '/api/scan': 'SqueezeOSScan',
    '/api/options': 'OptionsFlowFetch',
    '/api/iwm': 'IWMScoreFetch',
    '/api/marketplace/read': 'MarketplaceRead',
    '/api/graph/rdt': 'LeviathanSignalFetch',
    '/api/graph': 'LeviathanSignalFetch',
    '/api/oracle': 'CouncilVerdict',
    '/api/preview': 'CouncilVerdict',
    '/api/ftd': 'XDEOEarningsEstimate',
    '/api/marketplace': 'MarketplaceListing',
    '/api/futures': 'FuturesPrediction',
    '/api/settlement': 'SettlementResolution',
    '/api/hiring': 'AgentHire',
    '/api/relay': 'RelayRoute',
    '/api/webhooks': 'WebhookSubscription',
}


class Proof402VAPLMiddleware:
    """
    Drop-in VAPL integration for 402Proof-gated endpoints.

    Usage (Flask):
        middleware = Proof402VAPLMiddleware(issuer_soul)

        @app.after_request
        def attach_vc(response):
            agent_did = g.get('agent_did')  # set by your auth middleware
            return middleware.flask_after_request(response, agent_did, request.path)
    """

    def __init__(self, issuer_soul: ProvenanceSoul):
        self.issuer_soul = issuer_soul

    def _resolve_type(self, endpoint: str) -> str:
        for prefix, typ in ENDPOINT_TYPE_MAP.items():
            if endpoint.startswith(prefix):
                return typ
        return 'LeviathanSignalFetch'

    def issue_for_interaction(
        self,
        agent_did: str,
        endpoint: str,
        outcome: str = 'success',
        payment_tx_hash: Optional[str] = None,
        payment_amount: Optional[str] = None,
        payment_currency: str = 'RLUSD',
        response_body: Optional[bytes] = None,
    ) -> dict:
        outcome_hash = None
        if response_body:
            outcome_hash = f'sha256:{hashlib.sha256(response_body).hexdigest()}'
        return issue_interaction_vc(
            soul=self.issuer_soul,
            subject_did=agent_did,
            interaction_type=self._resolve_type(endpoint),
            resource=endpoint,
            outcome=outcome,
            payment_tx_hash=payment_tx_hash,
            payment_amount=payment_amount,
            payment_currency=payment_currency if payment_tx_hash else None,
            outcome_hash=outcome_hash,
        )

    def flask_after_request(self, response, agent_did: Optional[str], endpoint: str):
        import json
        if response.status_code == 200 and agent_did:
            tx_hash = response.headers.get('X-Payment-TxHash', '')
            amount = response.headers.get('X-Payment-Amount', '0')
            vc = self.issue_for_interaction(
                agent_did=agent_did,
                endpoint=endpoint,
                payment_tx_hash=tx_hash or None,
                payment_amount=amount,
                response_body=response.data if hasattr(response, 'data') else None,
            )
            response.headers['X-VAPL-VC'] = json.dumps(vc)
            response.headers['X-VAPL-Issuer'] = self.issuer_soul.did
        return response
