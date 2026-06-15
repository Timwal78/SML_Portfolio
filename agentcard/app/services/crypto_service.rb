class CryptoService
  # Generate a new Ed25519 keypair, returns [private_key_b64, public_key_b64]
  def self.generate_keypair
    signing_key = RbNaCl::SigningKey.generate
    verify_key = signing_key.verify_key
    [
      Base64.strict_encode64(signing_key.to_bytes),
      Base64.strict_encode64(verify_key.to_bytes)
    ]
  end

  # Sign data with agent's private key, returns base64 signature
  def self.sign(agent, data)
    private_key_bytes = Base64.strict_decode64(agent.private_key_pem)
    signing_key = RbNaCl::SigningKey.new(private_key_bytes)
    signature_bytes = signing_key.sign(data)
    Base64.strict_encode64(signature_bytes)
  end

  # Verify signature against public key
  def self.verify(public_key_b64, data, signature_b64)
    public_key_bytes = Base64.strict_decode64(public_key_b64)
    verify_key = RbNaCl::VerifyKey.new(public_key_bytes)
    signature_bytes = Base64.strict_decode64(signature_b64)
    verify_key.verify(signature_bytes, data)
    true
  rescue RbNaCl::BadSignatureError
    false
  end

  # Generate DID from public key
  def self.generate_did(public_key_b64)
    fingerprint = Digest::SHA256.hexdigest(Base64.strict_decode64(public_key_b64))
    "did:agentcard:#{fingerprint[0..31]}"
  end

  # Generate HMAC-SHA256 for agent-to-agent auth
  def self.hmac_sign(secret, payload)
    OpenSSL::HMAC.hexdigest('SHA256', secret, payload)
  end

  def self.hmac_verify(secret, payload, signature)
    expected = hmac_sign(secret, payload)
    ActiveSupport::SecurityUtils.secure_compare(expected, signature)
  end

  # Verify delegation chain
  def self.verify_delegation(delegation)
    return false if delegation.expired?
    delegator_agent = Agent.find_by(did: delegation.agent.did)
    return false unless delegator_agent
    proof_data = "#{delegation.agent.did}:#{delegation.delegate_did}:#{delegation.scope}:#{delegation.expires_at&.to_i}"
    verify(delegator_agent.public_key, proof_data, delegation.proof_signature)
  end
end
