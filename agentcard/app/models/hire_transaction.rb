# frozen_string_literal: true

class HireTransaction < ApplicationRecord
  belongs_to :agent
  has_one :review

  VALID_STATUSES = %w[pending payment_required paid processing completed failed].freeze

  validates :capability_id, presence: true
  validates :status,
            presence: true,
            inclusion: { in: VALID_STATUSES, message: "%{value} is not a valid status" }
  validates :idempotency_key, uniqueness: true, allow_blank: false

  before_create :set_idempotency_key

  scope :completed, -> { where(status: "completed") }
  scope :pending, -> { where(status: "pending") }
  scope :for_wallet, ->(address) { where(client_wallet_address: address) }

  # Transitions the transaction to the next valid status
  def transition_to!(new_status)
    unless VALID_STATUSES.include?(new_status.to_s)
      raise ArgumentError, "#{new_status} is not a valid status"
    end

    update!(status: new_status)
  end

  private

  def set_idempotency_key
    self.idempotency_key = SecureRandom.uuid if idempotency_key.blank?
  end
end
