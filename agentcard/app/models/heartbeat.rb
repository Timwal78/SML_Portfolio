# frozen_string_literal: true

class Heartbeat < ApplicationRecord
  self.record_timestamps = false

  belongs_to :agent

  before_validation :set_created_at

  after_create :update_agent_availability

  private

  def set_created_at
    self.created_at ||= Time.current
  end

  def update_agent_availability
    agent.update_columns(
      last_seen_at: created_at,
      status: "active",
      updated_at: Time.current
    )
  rescue ActiveRecord::ActiveRecordError => e
    Rails.logger.error("[Heartbeat#update_agent_availability] Failed for heartbeat #{id}: #{e.message}")
  end
end
