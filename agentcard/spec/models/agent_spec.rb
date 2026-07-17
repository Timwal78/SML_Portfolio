require 'rails_helper'

RSpec.describe Agent, type: :model do
  subject(:agent) { build(:agent) }

  describe 'validations' do
    it { is_expected.to validate_presence_of(:name) }
    it { is_expected.to validate_presence_of(:endpoint_url) }
    it { is_expected.to belong_to(:owner).class_name('User') }
    it { is_expected.to have_many(:capabilities).dependent(:destroy) }
    it { is_expected.to have_many(:reputation_events).dependent(:destroy) }
    it { is_expected.to have_many(:heartbeats).dependent(:destroy) }

    it 'validates status inclusion' do
      agent.status = 'unknown'
      expect(agent).not_to be_valid
      expect(agent.errors[:status]).to be_present
    end
  end

  describe 'keypair generation' do
    it 'generates a DID on create' do
      agent = create(:agent)
      expect(agent.did).to start_with('did:agentcard:')
    end

    it 'generates a slug on create' do
      agent = create(:agent, name: 'Code Review Bot')
      expect(agent.slug).to be_present
    end

    it 'generates Ed25519 public key on create' do
      agent = create(:agent)
      expect(agent.public_key).to be_present
      expect(agent.encrypted_private_key).to be_present
    end

    it 'ensures slug uniqueness with counter suffix' do
      first  = create(:agent, name: 'Test Bot')
      second = create(:agent, name: 'Test Bot', owner: first.owner)
      expect(second.slug).not_to eq(first.slug)
      expect(second.slug).to match(/test-bot-\d+/)
    end
  end

  describe '#available?' do
    it 'returns true when last_seen_at is within 5 minutes' do
      agent = build(:agent, last_seen_at: 2.minutes.ago)
      expect(agent.available?).to be true
    end

    it 'returns false when last_seen_at is older than 5 minutes' do
      agent = build(:agent, last_seen_at: 10.minutes.ago)
      expect(agent.available?).to be false
    end

    it 'returns false when last_seen_at is nil' do
      agent = build(:agent, last_seen_at: nil)
      expect(agent.available?).to be false
    end
  end

  describe '#sign_payload and #verify_signature' do
    let(:agent) { create(:agent) }

    it 'signs and verifies a payload round-trip' do
      payload = { did: agent.did, name: agent.name }
      signature = agent.sign_payload(payload)
      expect(signature).to be_present
      expect(agent.verify_signature(payload.to_json, signature)).to be true
    end

    it 'returns false for a tampered payload' do
      signature = agent.sign_payload({ data: 'original' })
      expect(agent.verify_signature('tampered', signature)).to be false
    end

    it 'returns false for an invalid signature' do
      expect(agent.verify_signature('any data', 'badsig==')).to be false
    end
  end

  describe 'scopes' do
    it '.active returns only active agents' do
      active   = create(:agent, status: 'active')
      inactive = create(:agent, status: 'inactive', owner: active.owner)
      expect(Agent.active).to include(active)
      expect(Agent.active).not_to include(inactive)
    end

    it '.available returns agents seen within 5 minutes' do
      recent = create(:agent, :available)
      stale  = create(:agent, last_seen_at: 10.minutes.ago, owner: recent.owner)
      expect(Agent.available).to include(recent)
      expect(Agent.available).not_to include(stale)
    end
  end
end
