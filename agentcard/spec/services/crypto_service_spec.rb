require 'rails_helper'

RSpec.describe CryptoService do
  describe '.generate_keypair' do
    it 'returns an array of two Base64 strings' do
      private_b64, public_b64 = CryptoService.generate_keypair
      expect(private_b64).to be_a(String)
      expect(public_b64).to be_a(String)
      expect(Base64.strict_decode64(private_b64).length).to eq(32)
      expect(Base64.strict_decode64(public_b64).length).to eq(32)
    end
  end

  describe '.sign and .verify' do
    let(:agent) { create(:agent) }
    let(:data)  { 'hello agentcard' }

    it 'produces a signature that verifies successfully' do
      sig = CryptoService.sign(agent, data)
      expect(sig).to be_present
      pub_b64 = Base64.strict_encode64(Base64.decode64(agent.public_key.sub(/\Az/, '')))
      expect(CryptoService.verify(pub_b64, data, sig)).to be true
    end

    it 'returns false when verifying with wrong data' do
      sig = CryptoService.sign(agent, data)
      pub_b64 = Base64.strict_encode64(Base64.decode64(agent.public_key.sub(/\Az/, '')))
      expect(CryptoService.verify(pub_b64, 'wrong', sig)).to be false
    end
  end

  describe '.generate_did' do
    it 'returns a did:agentcard: prefixed string' do
      _, public_b64 = CryptoService.generate_keypair
      did = CryptoService.generate_did(public_b64)
      expect(did).to match(/\Adid:agentcard:[a-f0-9]{32}\z/)
    end
  end

  describe '.hmac_sign and .hmac_verify' do
    let(:secret)  { SecureRandom.hex(32) }
    let(:payload) { 'timestamp:POST:/api/v1/agents:{}' }

    it 'verifies a matching signature' do
      sig = CryptoService.hmac_sign(secret, payload)
      expect(CryptoService.hmac_verify(secret, payload, sig)).to be true
    end

    it 'rejects a tampered payload' do
      sig = CryptoService.hmac_sign(secret, payload)
      expect(CryptoService.hmac_verify(secret, 'tampered', sig)).to be false
    end
  end
end
