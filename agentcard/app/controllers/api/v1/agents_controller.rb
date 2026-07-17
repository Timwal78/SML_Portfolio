module Api
  module V1
    class AgentsController < ApplicationController
      before_action :authenticate_user!,  only: %i[create update destroy stake]
      before_action :authenticate_agent!, only: %i[heartbeat]
      before_action :set_agent,           only: %i[show update destroy heartbeat hire reviews stake agentcard]
      before_action :authorize_owner!,    only: %i[update destroy stake]

      # GET /api/v1/agents
      # Returns the top 50 active agents sorted by reputation descending.
      def index
        agents = Agent.active
                      .includes(:capabilities)
                      .order(reputation_score: :desc)
                      .limit(50)
        render json: agents_json(agents)
      end

      # GET /api/v1/agents/:id
      def show
        render json: agent_json(@agent)
      end

      # POST /api/v1/agents
      def create
        agent = current_user.agents.build(agent_params)
        agent.save!
        render json: agent_json(agent), status: :created
      end

      # PATCH/PUT /api/v1/agents/:id
      def update
        @agent.update!(agent_params)
        render json: agent_json(@agent)
      end

      # DELETE /api/v1/agents/:id
      # Soft-deletes: marks the agent as deactivated rather than destroying
      # the record so audit trails and hire transactions remain intact.
      def destroy
        before_status = @agent.status

        @agent.update!(status: 'deactivated')

        AuditLog.log(
          table_name: 'agents',
          record_id:  @agent.id,
          action:     'deactivate',
          before:     { status: before_status },
          after:      { status: 'deactivated' },
          actor:      current_user
        )

        render json: { message: 'Agent deactivated' }
      end

      # POST /api/v1/agents/:id/heartbeat
      # Requires agent-level HMAC authentication (X-AgentCard-Signature).
      # Updates last_seen_at and refreshes status.
      def heartbeat
        Heartbeat.create!(agent: @agent, ip_address: request.remote_ip)
        @agent.update_availability!
        render json: { status: 'ok', last_seen_at: @agent.reload.last_seen_at }
      end

      # POST /api/v1/agents/:id/hire
      # Initiates a hire transaction. Returns HTTP 402 with x402 payment
      # requirements. Idempotent: the same Idempotency-Key returns the
      # cached response without creating a new transaction.
      def hire
        capability = @agent.capabilities.find_by!(capability_id: params[:capability_id])

        # Idempotency check — honour previously created transactions
        if idempotency_key
          existing = HireTransaction.find_by(idempotency_key: idempotency_key)
          return render json: hire_tx_json(existing) if existing
        end

        tx = HireTransaction.create!(
          agent:               @agent,
          capability_id:       capability.capability_id,
          payload:             params[:payload] || {},
          idempotency_key:     idempotency_key || SecureRandom.uuid,
          amount:              capability.price_amount,
          currency:            capability.price_currency,
          client_wallet_address: params[:client_wallet]
        )

        payment_svc = PaymentService.new(@agent, capability, params[:client_wallet])

        render json: {
          transaction_id:    tx.id,
          payment_required:  payment_svc.build_payment_requirements
        }, status: :payment_required
      end

      # POST /api/v1/agents/:id/reviews
      # Submits a review for a completed hire transaction.
      # Rating must be an integer 1–5. Triggers reputation recalculation.
      def reviews
        hire_tx = @agent.hire_transactions
                        .completed
                        .find(params[:hire_transaction_id])

        if idempotency_key
          existing = Review.find_by(idempotency_key: idempotency_key)
          return render json: existing if existing
        end

        review = Review.create!(
          agent:            @agent,
          hire_transaction: hire_tx,
          rating:           params[:rating].to_i,
          comment:          params[:comment],
          reviewer_wallet:  params[:reviewer_wallet],
          idempotency_key:  idempotency_key || SecureRandom.uuid
        )

        ReputationService.new(@agent).record_review(
          rating:           review.rating,
          reviewer:         review.reviewer_wallet,
          hire_transaction: hire_tx
        )

        render json: {
          review_id:      review.id,
          new_reputation: @agent.reload.reputation_score
        }, status: :created
      end

      # POST /api/v1/agents/:id/stake
      # Records an on-chain USDC stake for reputation bonding.
      # Requires the tx_hash of the confirmed on-chain transaction.
      def stake
        svc = ReputationService.new(@agent)
        svc.add_stake(
          amount:   params[:amount].to_d,
          currency: params.fetch(:currency, 'USDC'),
          tx_hash:  params[:tx_hash]
        )
        render json: {
          staked_amount: @agent.reload.staked_amount,
          badge:         svc.stake_badge
        }
      end

      # GET /api/v1/agents/:id/agentcard
      # Returns the raw signed AgentCard JSON object for this agent.
      def agentcard
        redirect_to api_v1_agent_agentcard_url(@agent.id),
                    to: "well_known/agent_cards#show",
                    status: :ok and return

        # Direct render path (same logic as WellKnown::AgentCardsController#show)
        service = AgentCardService.new(@agent)
        card    = service.build_and_sign

        JsonSchemaValidator.validate_card!(card.stringify_keys)

        response.set_header('X-AgentCard-Signature', card[:signature].to_s)
        response.set_header('X-AgentCard-Version', '1.0')
        render json: card, status: :ok
      end

      private

      # ---------------------------------------------------------------------------
      # Finders
      # ---------------------------------------------------------------------------

      # Accepts both numeric IDs and slugs in the :id segment.
      def set_agent
        param = params[:id]
        lookup = param.match?(/\A\d+\z/) ? { id: param } : { slug: param }
        @agent = Agent.includes(:capabilities).find_by!(lookup)
      end

      def authorize_owner!
        render_unauthorized unless @agent.owner == current_user
      end

      # ---------------------------------------------------------------------------
      # Strong parameters
      # ---------------------------------------------------------------------------

      def agent_params
        params.require(:agent).permit(
          :name,
          :description,
          :endpoint_url,
          capabilities_attributes: %i[
            capability_id
            name
            description
            pricing_model
            price_amount
            price_currency
            input_schema
            output_schema
          ]
        )
      end

      # ---------------------------------------------------------------------------
      # Serialisation helpers
      # ---------------------------------------------------------------------------

      def agent_json(agent)
        AgentCardService.new(agent).build_and_sign
      end

      def agents_json(agents)
        agents.map { |a| AgentCardService.new(a).build_card }
      end

      def hire_tx_json(tx)
        {
          transaction_id:   tx.id,
          status:           tx.status,
          idempotency_key:  tx.idempotency_key
        }
      end
    end
  end
end
