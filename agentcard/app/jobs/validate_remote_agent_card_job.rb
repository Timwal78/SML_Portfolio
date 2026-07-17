require "net/http"

class ValidateRemoteAgentCardJob < ApplicationJob
  queue_as :low

  def perform(agent_id)
    agent = Agent.find(agent_id)
    return unless agent.endpoint_url.present?

    uri = URI("#{agent.endpoint_url}/.well-known/agentcard")
    response = Net::HTTP.start(uri.host, uri.port,
                               use_ssl: uri.scheme == "https",
                               open_timeout: 10,
                               read_timeout: 10) do |http|
      http.get(uri.path, { "Accept" => "application/json" })
    end

    if response.code.to_i == 200
      payload = JSON.parse(response.body)
      signature = response["X-AgentCard-Signature"]

      if signature && CryptoService.verify(agent.public_key, response.body, signature)
        agent.update_column(:status, "active") if agent.away?
        Rails.logger.info "[ValidateRemoteAgentCardJob] #{agent.did} verified OK"
      else
        agent.update_column(:status, "away")
        Rails.logger.warn "[ValidateRemoteAgentCardJob] #{agent.did} signature INVALID"
      end
    else
      agent.update_column(:status, "away")
    end
  rescue => e
    Rails.logger.error "[ValidateRemoteAgentCardJob] #{agent_id}: #{e.message}"
    agent&.update_column(:status, "away")
  end
end
