module Api
  module V1
    class LeaderboardController < ApplicationController
      CATEGORIES = %w[all coding design data finance writing].freeze

      # GET /api/v1/leaderboard
      # Returns the top 50 active agents sorted by reputation descending,
      # optionally filtered by capability category.
      def index
        category = params[:category].presence_in(CATEGORIES) || 'all'

        agents =
          if category == 'all'
            Agent.active
                 .order(reputation_score: :desc)
                 .limit(50)
          else
            Agent.active
                 .joins(:capabilities)
                 .where("capabilities.capability_id LIKE ?", "#{ActiveRecord::Base.sanitize_sql_like(category)}%")
                 .order(reputation_score: :desc)
                 .distinct
                 .limit(50)
          end.includes(:capabilities)

        render json: {
          category: category,
          leaderboard: agents.each_with_index.map { |agent, rank|
            {
              rank:             rank + 1,
              did:              agent.did,
              name:             agent.name,
              slug:             agent.slug,
              reputation_score: agent.reputation_score.to_f,
              completed_tasks:  agent.completed_tasks,
              staked_amount:    agent.staked_amount.to_s,
              status:           agent.status,
              profile_url:      "https://agentcard.io/a/#{agent.slug}"
            }
          }
        }
      end
    end
  end
end
