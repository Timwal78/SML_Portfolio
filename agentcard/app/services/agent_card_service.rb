class AgentCardService
  SCHEMA_VERSION = "1.0".freeze

  def initialize(agent)
    @agent = agent
  end

  def build_card
    {
      schema_version: SCHEMA_VERSION,
      did: @agent.did,
      name: @agent.name,
      description: @agent.description,
      endpoint: @agent.endpoint_url,
      capabilities: capabilities_payload,
      authentication: {
        type: "api_key",
        location: "header",
        name: "X-API-Key"
      },
      payment: {
        protocol: "x402",
        facilitator: ENV.fetch('X402_FACILITATOR_URL', 'https://facilitator.agentcard.io'),
        accepts: ["USDC"]
      },
      reputation: {
        score: @agent.reputation_score.to_f,
        completed_tasks: @agent.completed_tasks,
        staked_amount: @agent.staked_amount.to_s,
        staked_currency: @agent.staked_currency || "USDC"
      }
    }
  end

  def build_and_sign
    card = build_card
    signature = sign_card(card)
    card.merge(signature: signature)
  end

  private

  def capabilities_payload
    @agent.capabilities.map { |cap|
      {
        id: cap.capability_id,
        name: cap.name,
        description: cap.description,
        input_schema: cap.input_schema.presence || {},
        output_schema: cap.output_schema.presence || {},
        pricing: cap.pricing_hash
      }
    }
  end

  def sign_card(card)
    CryptoService.sign(@agent, card.to_json)
  end
end
