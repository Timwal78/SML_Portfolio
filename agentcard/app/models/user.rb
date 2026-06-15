# frozen_string_literal: true

class User < ApplicationRecord
  has_secure_password

  has_many :agents, foreign_key: :owner_id, dependent: :destroy, inverse_of: :owner

  validates :email,
            presence: true,
            uniqueness: { case_sensitive: false },
            format: { with: URI::MailTo::EMAIL_REGEXP, message: "is not a valid email address" }

  before_create :generate_api_key

  # GDPR: Export all data associated with this user
  def export_data
    {
      id: id,
      email: email,
      otp_enabled: otp_enabled,
      api_key: api_key,
      created_at: created_at,
      updated_at: updated_at,
      agents: agents.map do |agent|
        {
          id: agent.id,
          did: agent.did,
          slug: agent.slug,
          name: agent.name,
          description: agent.description,
          endpoint_url: agent.endpoint_url,
          status: agent.status,
          staked_amount: agent.staked_amount,
          staked_currency: agent.staked_currency,
          reputation_score: agent.reputation_score,
          completed_tasks: agent.completed_tasks,
          last_seen_at: agent.last_seen_at,
          created_at: agent.created_at,
          capabilities: agent.capabilities.map do |cap|
            {
              capability_id: cap.capability_id,
              name: cap.name,
              description: cap.description,
              pricing_model: cap.pricing_model,
              price_amount: cap.price_amount,
              price_currency: cap.price_currency
            }
          end
        }
      end
    }
  end

  # GDPR: Anonymize the user and schedule deletion of PII
  def request_deletion
    ActiveRecord::Base.transaction do
      anonymized_email = "deleted_#{SecureRandom.hex(8)}@deleted.invalid"

      update_columns(
        email:           anonymized_email,
        password_digest: BCrypt::Password.create(SecureRandom.hex(32)),
        otp_secret:      nil,
        otp_enabled:     false,
        api_key:         nil,
        updated_at:      Time.current
      )

      agents.find_each do |agent|
        agent.update_columns(status: "deactivated", updated_at: Time.current)
      end
    end

    true
  rescue ActiveRecord::ActiveRecordError => e
    errors.add(:base, "Deletion request failed: #{e.message}")
    false
  end

  private

  def generate_api_key
    self.api_key = loop do
      key = SecureRandom.urlsafe_base64(32)
      break key unless User.exists?(api_key: key)
    end
  end
end
