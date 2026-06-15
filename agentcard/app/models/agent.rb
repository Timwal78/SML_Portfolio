# frozen_string_literal: true

require "rbnacl"
require "base64"

class Agent < ApplicationRecord
  include PgSearch::Model

  belongs_to :owner, class_name: "User", inverse_of: :agents

  has_many :capabilities, dependent: :destroy
  has_many :reputation_events, dependent: :destroy
  has_many :delegations, dependent: :destroy
  has_many :heartbeats, dependent: :destroy
  has_many :hire_transactions, dependent: :nullify
  has_many :reviews, through: :hire_transactions

  VALID_STATUSES = %w[active away inactive deactivated].freeze

  validates :name, presence: true
  validates :did, presence: true, uniqueness: true
  validates :slug, presence: true, uniqueness: true
  validates :public_key, presence: true
  validates :endpoint_url, presence: true
  validates :status, inclusion: { in: VALID_STATUSES, message: "%{value} is not a valid status" }

  accepts_nested_attributes_for :capabilities, allow_destroy: true

  before_create :generate_did, :generate_keypair, :generate_slug
  after_commit :enqueue_card_rebuild
  after_commit :update_search_vector, on: %i[create update]

  pg_search_scope :search_by_text,
                  against: { name: "A", description: "B" },
                  associated_against: {
                    capabilities: { name: "C", description: "D" }
                  },
                  using: {
                    tsearch: { dictionary: "english", tsvector_column: "search_vector" },
                    trigram: { threshold: 0.3 }
                  }

  scope :active, -> { where(status: "active") }
  scope :available, -> { active.where("last_seen_at > ?", 5.minutes.ago) }

  # Lockbox attribute encryption for private key
  # Falls back to plain attribute if lockbox is not configured
  def private_key_pem
    return @private_key_pem if defined?(@private_key_pem)

    raw = self[:encrypted_private_key]
    return nil if raw.nil?

    if defined?(Lockbox) && Lockbox.default_key.present?
      box = Lockbox.new(key: Lockbox.default_key)
      @private_key_pem = box.decrypt(Base64.decode64(raw))
    else
      @private_key_pem = raw
    end
  rescue StandardError
    nil
  end

  def private_key_pem=(value)
    @private_key_pem = value

    if value.nil?
      self[:encrypted_private_key] = nil
      return
    end

    if defined?(Lockbox) && Lockbox.default_key.present?
      box = Lockbox.new(key: Lockbox.default_key)
      self[:encrypted_private_key] = Base64.strict_encode64(box.encrypt(value))
    else
      self[:encrypted_private_key] = value
    end
  end

  # Returns true if the agent sent a heartbeat within the last 5 minutes
  def available?
    last_seen_at.present? && last_seen_at > 5.minutes.ago
  end

  # Updates agent status based on most recent heartbeat
  def update_availability!
    new_status = if last_seen_at.nil?
                   "inactive"
                 elsif last_seen_at > 5.minutes.ago
                   "active"
                 elsif last_seen_at > 30.minutes.ago
                   "away"
                 else
                   "inactive"
                 end

    update_column(:status, new_status) if status != new_status && status != "deactivated"
  end

  # Builds the full AgentCard JSON hash per the A2A/AgentCard spec
  def generate_card_payload
    {
      "@context" => "https://agentcard.io/ns/v1",
      "type" => "AgentCard",
      "version" => "1.0",
      "did" => did,
      "slug" => slug,
      "name" => name,
      "description" => description,
      "endpoint" => endpoint_url,
      "publicKey" => {
        "type" => "Ed25519VerificationKey2020",
        "publicKeyMultibase" => public_key
      },
      "capabilities" => capabilities.map { |cap|
        {
          "id" => cap.capability_id,
          "name" => cap.name,
          "description" => cap.description,
          "inputSchema" => cap.input_schema,
          "outputSchema" => cap.output_schema,
          "pricing" => cap.pricing_hash
        }
      },
      "reputation" => {
        "score" => reputation_score.to_f,
        "completedTasks" => completed_tasks,
        "lastUpdated" => updated_at&.iso8601
      },
      "stake" => staked_amount.positive? ? {
        "amount" => staked_amount.to_s,
        "currency" => staked_currency
      } : nil,
      "status" => status,
      "lastSeen" => last_seen_at&.iso8601,
      "issuedAt" => created_at&.iso8601
    }.compact
  end

  # Signs a payload hash with this agent's Ed25519 private key
  # Returns Base64-encoded signature string, or nil if no private key available
  def sign_payload(payload_hash)
    pem = private_key_pem
    return nil if pem.nil?

    raw_private_key = decode_key_bytes(pem)
    signing_key = RbNaCl::SigningKey.new(raw_private_key)
    payload_str = payload_hash.is_a?(String) ? payload_hash : payload_hash.to_json
    signature_bytes = signing_key.sign(payload_str)
    Base64.strict_encode64(signature_bytes)
  rescue RbNaCl::CryptoError, ArgumentError => e
    Rails.logger.error("[Agent#sign_payload] Signing failed for agent #{id}: #{e.message}")
    nil
  end

  # Verifies a base64-encoded signature against this agent's public key
  def verify_signature(payload_str, signature_b64)
    return false if public_key.blank? || signature_b64.blank?

    raw_public_key = decode_key_bytes(public_key)
    verify_key = RbNaCl::VerifyKey.new(raw_public_key)
    signature_bytes = Base64.decode64(signature_b64)
    payload_bytes = payload_str.is_a?(String) ? payload_str : payload_str.to_json
    verify_key.verify(signature_bytes, payload_bytes)
  rescue RbNaCl::BadSignatureError, RbNaCl::CryptoError, ArgumentError
    false
  end

  # Calculates reputation score as a weighted average from reputation_events
  def calculate_reputation_score
    events = reputation_events.order(created_at: :desc).limit(100)
    return 0.0 if events.empty?

    weights = {
      "review_received" => 0.40,
      "task_completed" => 0.30,
      "stake_added" => 0.20,
      "stake_slashed" => -0.50
    }

    total_weight = 0.0
    weighted_sum = 0.0

    events.each_with_index do |event, index|
      # More recent events get higher weight (exponential decay)
      recency_weight = Math.exp(-index * 0.05)
      event_weight = (weights[event.event_type] || 0.10).abs * recency_weight

      weighted_sum += event.score_delta.to_f * event_weight
      total_weight += event_weight
    end

    return 0.0 if total_weight.zero?

    raw_score = weighted_sum / total_weight
    # Clamp to [-1.0, 1.0] then normalize to [0.0, 1.0]
    normalized = (raw_score.clamp(-1.0, 1.0) + 1.0) / 2.0
    normalized.round(2)
  end

  private

  def generate_did
    return if did.present?

    self.did = "did:agentcard:#{SecureRandom.hex(16)}"
  end

  def generate_slug
    return if slug.present?

    base_slug = name.present? ? name.parameterize : SecureRandom.hex(4)
    candidate = base_slug
    counter = 1

    while Agent.exists?(slug: candidate)
      candidate = "#{base_slug}-#{counter}"
      counter += 1
    end

    self.slug = candidate
  end

  def generate_keypair
    return if public_key.present? && encrypted_private_key.present?

    signing_key = RbNaCl::SigningKey.generate
    verify_key = signing_key.verify_key

    # Store public key as multibase (base58btc) — prefix with 'z' per multibase spec
    self.public_key = "z#{Base64.strict_encode64(verify_key.to_bytes)}"
    self.private_key_pem = Base64.strict_encode64(signing_key.to_bytes)
  end

  def enqueue_card_rebuild
    RebuildAgentCardJob.perform_later(id) if persisted?
  end

  def rebuild_card_payload_async
    RebuildAgentCardJob.perform_later(id) if persisted?
  end

  def rebuild_card_payload
    payload = generate_card_payload
    update_column(:card_payload, payload) if persisted?
  rescue ActiveRecord::ActiveRecordError => e
    Rails.logger.error("[Agent#rebuild_card_payload] Failed for agent #{id}: #{e.message}")
  end

  def update_search_vector
    return unless persisted?

    self.class.where(id: id).update_all(
      "search_vector = to_tsvector('english', coalesce(name,'') || ' ' || coalesce(description,''))"
    )
  rescue ActiveRecord::ActiveRecordError => e
    Rails.logger.error("[Agent#update_search_vector] Failed for agent #{id}: #{e.message}")
  end

  def decode_key_bytes(key_str)
    # Handle multibase prefix 'z' (base58btc) or plain base64
    if key_str.start_with?("z")
      Base64.decode64(key_str[1..])
    else
      Base64.decode64(key_str)
    end
  end
end
