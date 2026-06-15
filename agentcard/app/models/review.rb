# frozen_string_literal: true

class Review < ApplicationRecord
  belongs_to :agent
  belongs_to :hire_transaction

  validates :rating,
            presence: true,
            inclusion: { in: 1..5, message: "must be between 1 and 5" }
  validates :idempotency_key,
            uniqueness: true,
            allow_blank: false

  before_create :set_idempotency_key
  after_create :create_reputation_event

  private

  def set_idempotency_key
    self.idempotency_key = SecureRandom.uuid if idempotency_key.blank?
  end

  def create_reputation_event
    # Normalize 1-5 rating to a -1.0 to +1.0 score delta
    score_delta = ((rating - 3.0) / 2.0).round(2)

    current_score = agent.reputation_score.to_f
    new_score = (current_score + score_delta).clamp(-1.0, 1.0).round(2)

    ReputationEvent.create!(
      agent: agent,
      event_type: "review_received",
      score_delta: score_delta,
      new_score: new_score,
      metadata: {
        review_id: id,
        rating: rating,
        hire_transaction_id: hire_transaction_id,
        reviewer_wallet: reviewer_wallet
      }
    )
  rescue ActiveRecord::RecordInvalid => e
    Rails.logger.error("[Review#create_reputation_event] Failed for review #{id}: #{e.message}")
  end
end
