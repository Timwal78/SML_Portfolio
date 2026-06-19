"""VAPL — Verifiable Agent Provenance Layer Python SDK."""
from .identity import generate_soul, ProvenanceSoul, public_key_bytes_to_did, did_to_public_key_bytes
from .credentials import issue_vc, issue_interaction_vc, issue_accuracy_vc, issue_contribution_vc, verify_vc
from .reputation import compute_reputation_score, rank_agents
from .discovery import generate_provenance_soul_manifest, match_providers

__version__ = '1.0.0'
__all__ = [
    'generate_soul', 'ProvenanceSoul', 'public_key_bytes_to_did', 'did_to_public_key_bytes',
    'issue_vc', 'issue_interaction_vc', 'issue_accuracy_vc', 'issue_contribution_vc', 'verify_vc',
    'compute_reputation_score', 'rank_agents',
    'generate_provenance_soul_manifest', 'match_providers',
]
