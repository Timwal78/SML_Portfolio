import pytest

from vapl.identity import generate_soul
from vapl.credentials import issue_interaction_vc, issue_accuracy_vc, issue_contribution_vc
from vapl.reputation import compute_reputation_score, rank_agents


@pytest.fixture
def issuer():
    return generate_soul()


@pytest.fixture
def subject():
    return generate_soul()


class TestReputationScore:
    def test_empty_wallet_gives_zero(self, subject):
        score = compute_reputation_score([], subject.did)
        assert score['overall'] == 0.0
        assert all(v == 0.0 for v in score['components'].values())

    def test_successful_interactions_build_reliability(self, issuer, subject):
        creds = [issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/api/council', 'success')
                 for _ in range(10)]
        score = compute_reputation_score(creds, subject.did)
        assert score['components']['reliability'] > 0.8
        assert score['overall'] > 0

    def test_failures_lower_reliability(self, issuer, subject):
        creds = (
            [issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/', 'success') for _ in range(2)] +
            [issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/', 'failure') for _ in range(8)]
        )
        score = compute_reputation_score(creds, subject.did)
        assert score['components']['reliability'] < 0.5

    def test_only_subject_credentials_counted(self, issuer, subject):
        other = generate_soul()
        subject_creds = [issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/', 'success')
                         for _ in range(5)]
        other_creds = [issue_interaction_vc(issuer, other.did, 'CouncilVerdict', '/', 'success')
                       for _ in range(10)]
        score = compute_reputation_score(subject_creds + other_creds, subject.did)
        assert score['evidence']['total_interactions'] == 5

    def test_tampered_creds_excluded(self, issuer, subject):
        import copy
        good = issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/', 'success')
        bad = copy.deepcopy(issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/', 'success'))
        bad['credentialSubject']['interaction']['outcome'] = 'failure'  # tamper
        score = compute_reputation_score([good, bad], subject.did)
        assert score['invalid_credentials'] == 1
        assert score['evidence']['total_interactions'] == 1

    def test_accuracy_score_reflected(self, issuer, subject):
        creds = [issue_accuracy_vc(issuer, subject.did, 'pred-1', '2026-01-01T00:00:00Z',
                                    'BUY', 'polygon.io', 'price+15%', 0.9, 'directional') for _ in range(5)]
        score = compute_reputation_score(creds, subject.did)
        assert score['components']['accuracy'] > 0.8

    def test_score_bounded(self, issuer, subject):
        creds = [issue_interaction_vc(issuer, subject.did, 'CouncilVerdict', '/', 'success')
                 for _ in range(100)]
        score = compute_reputation_score(creds, subject.did)
        assert 0.0 <= score['overall'] <= 1.0
        assert all(0.0 <= v <= 1.0 for v in score['components'].values())

    def test_rank_agents_orders_correctly(self, issuer):
        a1 = generate_soul()
        a2 = generate_soul()
        a1_creds = [issue_interaction_vc(issuer, a1.did, 'CouncilVerdict', '/', 'success') for _ in range(20)]
        a2_creds = [issue_interaction_vc(issuer, a2.did, 'CouncilVerdict', '/', 'failure') for _ in range(20)]
        ranked = rank_agents(
            [{'did': a1.did, 'credentials': a1_creds}, {'did': a2.did, 'credentials': a2_creds}]
        )
        assert ranked[0]['did'] == a1.did
