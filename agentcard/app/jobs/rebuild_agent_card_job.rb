class RebuildAgentCardJob < ApplicationJob
  queue_as :default

  def perform(agent_id)
    agent = Agent.includes(:capabilities).find(agent_id)
    card = AgentCardService.new(agent).build_and_sign

    # Cache the signed card in Redis for 60 seconds
    Rails.cache.write(
      "agentcard:#{agent.did}",
      card.to_json,
      expires_in: 60.seconds
    )

    # Update card_payload column
    agent.update_column(:card_payload, card)

    Rails.logger.info "[RebuildAgentCardJob] Rebuilt card for #{agent.did}"
  end
end
