import copy
from datetime import datetime, timezone, timedelta

import pytest

from vapl.identity import generate_soul
from vapl.credentials import issue_vc, issue_interaction_vc, verify_vc


@pytest.fixture
def issuer():
    return generate_soul()


@pytest.fixture
def subject():
    return generate_soul()


class TestIssueVC:
    def test_issues_with_correct_fields(self, issuer, subject):
        vc = issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/api/council', 'success')
        assert vc['issuer'] == issuer.did
        assert vc['credentialSubject']['id'] == subject.did
        assert vc['proof']['cryptosuite'] == 'eddsa-vapl-2024'
        assert 'InteractionCredential' in vc['type']

    def test_unique_ids(self, issuer, subject):
        v1 = issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/', 'success')
        v2 = issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/', 'success')
        assert v1['id'] != v2['id']

    def test_proof_nonce_is_random(self, issuer, subject):
        v1 = issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/', 'success')
        v2 = issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/', 'success')
        assert v1['proof']['nonce'] != v2['proof']['nonce']


class TestVerifyVC:
    def test_valid_vc_passes(self, issuer, subject):
        vc = issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/api/council', 'success')
        result = verify_vc(vc, trusted_issuers=[issuer.did])
        assert result['valid'] is True
        assert result['errors'] == []
        assert result['issuer_did'] == issuer.did

    def test_tampered_outcome_rejected(self, issuer, subject):
        vc = issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/api/council', 'failure')
        tampered = copy.deepcopy(vc)
        tampered['credentialSubject']['interaction']['outcome'] = 'success'
        result = verify_vc(tampered)
        assert result['valid'] is False
        assert any('tampered' in e for e in result['errors'])

    def test_untrusted_issuer_rejected(self, issuer, subject):
        vc = issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/api/council', 'success')
        attacker = generate_soul()
        result = verify_vc(vc, trusted_issuers=[attacker.did])
        assert result['valid'] is False
        assert any('trusted issuers' in e for e in result['errors'])

    def test_missing_proof_rejected(self, issuer, subject):
        vc = issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/api/council', 'success')
        del vc['proof']
        result = verify_vc(vc)
        assert result['valid'] is False
        assert any('proof' in e for e in result['errors'])

    def test_expired_vc_rejected(self, issuer, subject):
        vc = issue_vc(issuer, subject.did, 'InteractionCredential', {
            'interaction': {'type': 'CouncilVerdict', 'resource': '/', 'timestamp': 'T', 'outcome': 'success', 'nonce': 'n'}
        }, validity_seconds=-1)
        result = verify_vc(vc, check_expiry=True)
        assert result['valid'] is False
        assert any('expired' in e.lower() for e in result['errors'])

    def test_missing_context_rejected(self, issuer, subject):
        vc = issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/api/council', 'success')
        vc['@context'] = ['https://www.w3.org/ns/credentials/v1']  # wrong version
        result = verify_vc(vc)
        assert result['valid'] is False

    def test_non_did_key_issuer_rejected(self, issuer, subject):
        vc = issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/api/council', 'success')
        vc['issuer'] = 'did:web:evil.example.com'
        result = verify_vc(vc)
        assert result['valid'] is False

    def test_verify_without_trusted_filter(self, issuer, subject):
        vc = issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/api/council', 'success')
        result = verify_vc(vc)  # no trusted_issuers
        assert result['valid'] is True
