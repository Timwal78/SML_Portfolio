class WeeklyDigestJob < ApplicationJob
  queue_as :mailer

  def perform
    top_agents = Agent.active.order(reputation_score: :desc).limit(10).includes(:capabilities)

    User.where(weekly_digest: true).find_each do |user|
      AgentDigestMailer.weekly_digest(user, top_agents).deliver_now
    rescue => e
      Rails.logger.error "[WeeklyDigestJob] Failed for user #{user.id}: #{e.message}"
    end

    Rails.logger.info "[WeeklyDigestJob] Digest sent"
  end
end
