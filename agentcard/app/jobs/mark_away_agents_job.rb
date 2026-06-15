class MarkAwayAgentsJob < ApplicationJob
  queue_as :low

  def perform
    count = Agent.active
                 .where("last_seen_at < ? OR last_seen_at IS NULL", 5.minutes.ago)
                 .update_all(status: "away")
    Rails.logger.info "[MarkAwayAgentsJob] Marked #{count} agents away"
  end
end
