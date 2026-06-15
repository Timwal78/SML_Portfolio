module WellKnown
  class AgentCardsController < ApplicationController
    # GET /.well-known/agentcard
    # Returns the canonical platform-level AgentCard, describing this
    # infrastructure node to crawlers, wallets, and agent orchestrators.
    def global
      card = {
        schema_version: "1.0",
        did: "did:agentcard:platform",
        name: "AgentCard Platform",
        description: "Universal identity, discovery, and commerce layer for AI agents",
        endpoint: "https://agentcard.io",
        capabilities: [
          {
            id: "agent_discovery",
            name: "Agent Discovery",
            description: "Find and hire AI agents by capability",
            input_schema: {},
            output_schema: {},
            pricing: {
              model:    "free",
              amount:   "0",
              currency: "USDC",
              network:  "base"
            }
          },
          {
            id: "agent_registration",
            name: "Agent Registration",
            description: "Register an AI agent and receive a signed DID",
            input_schema: {
              type: "object",
              required: %w[name endpoint_url],
              properties: {
                name:         { type: "string" },
                description:  { type: "string" },
                endpoint_url: { type: "string", format: "uri" }
              }
            },
            output_schema: {
              type: "object",
              properties: {
                did:  { type: "string" },
                slug: { type: "string" }
              }
            },
            pricing: {
              model:    "free",
              amount:   "0",
              currency: "USDC",
              network:  "base"
            }
          },
          {
            id: "hire_facilitation",
            name: "Hire Facilitation",
            description: "Broker x402 payments between hiring agents and service agents",
            input_schema: {},
            output_schema: {},
            pricing: {
              model:    "percentage",
              amount:   "2.5",
              currency: "USDC",
              network:  "base"
            }
          }
        ],
        authentication: {
          type:     "api_key",
          location: "header",
          name:     "Authorization"
        },
        payment: {
          protocol:    "x402",
          facilitator: ENV.fetch('X402_FACILITATOR_URL', 'https://facilitator.agentcard.io'),
          accepts:     ["USDC"]
        },
        reputation: {
          score:           5.0,
          completed_tasks: 0,
          staked_amount:   "0",
          staked_currency: "USDC"
        }
      }

      response.set_header('X-AgentCard-Version', '1.0')
      render json: card, status: :ok
    end

    # GET /api/v1/agents/:agent_id/agentcard
    # Returns a signed AgentCard for a specific agent, validated against
    # the JSON schema before being served.
    def show
      @agent  = Agent.includes(:capabilities).find(params[:agent_id])
      service = AgentCardService.new(@agent)
      card    = service.build_and_sign

      # Validate against schema — raises JsonSchemaValidator::ValidationError
      # which is rescued in ApplicationController#schema_invalid.
      JsonSchemaValidator.validate_card!(card.stringify_keys)

      response.set_header('X-AgentCard-Signature', card[:signature].to_s)
      response.set_header('X-AgentCard-Version', '1.0')
      render json: card, status: :ok
    end
  end
end
