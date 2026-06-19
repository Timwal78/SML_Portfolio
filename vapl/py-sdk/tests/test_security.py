import copy
import pytest

from vapl.identity import generate_soul
from vapl.credentials import issue_interaction_vc, verify_vc


@pytest.fixture
def issuer():
    return generate_soul()


@pytest.fixture
def subject():
    return generate_soul()


class TestSignatureForgery:
    def test_cannot_forge_with_attacker_key(self, issuer, subject):
        attacker = generate_soul()
        real = issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/', 'success')
        fake = issue_interaction_vc(attacker, subject.did, 'CouncilVerdict', '/', 'success')
        forged = {**real, 'proof': fake['proof']}
        assert verify_vc(forged, trusted_issuers=[issuer.did])['valid'] is False

    def test_cannot_swap_subject_did(self, issuer, subject):
        imposter = generate_soul()
        vc = issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/', 'success')
        swapped = copy.deepcopy(vc)
        swapped['credentialSubject']['id'] = imposter.did
        assert verify_vc(swapped)['valid'] is False

    def test_cannot_upgrade_outcome(self, issuer, subject):
        vc = issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/', 'failure')
        upgraded = copy.deepcopy(vc)
        upgraded['credentialSubject']['interaction']['outcome'] = 'success'
        assert verify_vc(upgraded)['valid'] is False

    def test_zero_signature_rejected(self, issuer, subject):
        vc = issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/', 'success')
        zeroed = copy.deepcopy(vc)
        zeroed['proof']['proofValue'] = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
        assert verify_vc(zeroed)['valid'] is False

    def test_did_web_issuer_rejected(self, issuer, subject):
        vc = issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/', 'success')
        evil = copy.deepcopy(vc)
        evil['issuer'] = 'did:web:evil.example.com'
        assert verify_vc(evil)['valid'] is False

    def test_cannot_extend_validity(self, issuer, subject):
        vc = issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/', 'success')
        extended = copy.deepcopy(vc)
        extended['validUntil'] = '2099-01-01T00:00:00Z'
        assert verify_vc(extended)['valid'] is False

    def test_empty_proof_value_rejected(self, issuer, subject):
        vc = issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/', 'success')
        vc['proof']['proofValue'] = ''
        assert verify_vc(vc)['valid'] is False

    def test_vm_not_matching_issuer_rejected(self, issuer, subject):
        other = generate_soul()
        vc = issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/', 'success')
        bad = copy.deepcopy(vc)
        bad['proof']['verificationMethod'] = other.verification_method_id
        assert verify_vc(bad)['valid'] is False
