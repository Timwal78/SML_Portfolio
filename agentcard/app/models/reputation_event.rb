# frozen_string_literal: true

class ReputationEvent < ApplicationRecord
  self.ignored_columns = [] # ensure updated_at absence doesn't cause issues

  belongs_to :agent

  VALID_EVENT_TYPES = %w[review_received task_completed stake_added stake_slashed].freeze

  validates :event_type,
            presence: true,
            inclusion: { in: VALID_EVENT_TYPES, message: "%{value} is not a valid event type" }

  after_create :recalculate_agent_score

  private

  def recalculate_agent_score
    new_score = agent.calculate_reputation_score
    agent.update_column(:reputation_score, new_score)
  rescue ActiveRecord::ActiveRecordError => e
    Rails.logger.error("[ReputationEvent#recalculate_agent_score] Failed for event #{id}: #{e.message}")
  end
end
