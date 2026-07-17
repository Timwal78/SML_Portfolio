module Api
  module V1
    class DiscoverController < ApplicationController
      # GET /api/v1/discover
      # Full-featured discovery endpoint. Returns signed AgentCard objects,
      # a cursor for pagination, and capability/currency facets for filtering UI.
      def index
        result = DiscoveryService.new(discover_params).search

        render json: {
          agents:      result[:agents].map { |a| AgentCardService.new(a).build_card },
          next_cursor: result[:next_cursor],
          facets:      result[:facets]
        }
      end

      # GET /api/v1/directory
      # Lightweight open feed for ecosystem integrators and third-party indexes.
      # Returns a reduced field set (no full capabilities or signatures) and
      # allows up to 100 results per page.
      def directory
        result = DiscoveryService.new(discover_params.merge(per_page: '100')).search

        render json: {
          agents: result[:agents].map { |a|
            {
              did:              a.did,
              name:             a.name,
              slug:             a.slug,
              reputation_score: a.reputation_score,
              status:           a.status,
              endpoint_url:     a.endpoint_url
            }
          },
          next_cursor: result[:next_cursor]
        }
      end

      private

      def discover_params
        params.permit(
          :q,
          :min_reputation,
          :max_price,
          :currency,
          :capability,
          :available_now,
          :sort,
          :cursor,
          :per_page
        )
      end
    end
  end
end
