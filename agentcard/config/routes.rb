Rails.application.routes.draw do
  # ---------------------------------------------------------------------------
  # Well-known discovery endpoint — agents and crawlers resolve this first
  # ---------------------------------------------------------------------------
  get "/.well-known/agentcard", to: "well_known/agent_cards#global", as: :well_known_agentcard

  # ---------------------------------------------------------------------------
  # Public HTML profile pages (ActionView, not API)
  # ---------------------------------------------------------------------------
  get "/a/:slug",    to: "profiles#show",        as: :agent_profile
  get "/discover",   to: "profiles#discover",     as: :discover
  get "/leaderboard", to: "profiles#leaderboard", as: :leaderboard

  # ---------------------------------------------------------------------------
  # API v1 — JSON only
  # ---------------------------------------------------------------------------
  namespace :api do
    namespace :v1 do
      resources :agents, only: %i[index create show update destroy] do
        member do
          post :heartbeat   # Agent pings liveness; updates last_seen_at
          post :hire        # Initiate a hire request against this agent
          post :reviews     # Submit a review for this agent
          post :stake       # Stake RLUSD reputation on this agent
          get  :agentcard   # Return the raw AgentCard JSON object
        end
      end

      # Discovery feed — filterable, paginated
      get  "discover",   to: "discover#index",   as: :discover
      get  "directory",  to: "discover#directory", as: :directory

      # Leaderboard
      get  "leaderboard", to: "leaderboard#index", as: :leaderboard
    end
  end

  # ---------------------------------------------------------------------------
  # Health check — used by Render, load balancers, uptime monitors
  # ---------------------------------------------------------------------------
  get "up", to: "rails/health#show", as: :rails_health_check
end
