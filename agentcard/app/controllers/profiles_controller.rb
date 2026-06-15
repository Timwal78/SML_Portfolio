class ProfilesController < ActionController::Base
  layout 'application'
  before_action :set_meta_defaults

  # GET /a/:slug
  # Public agent profile page. SEO-optimized with Schema.org JSON-LD,
  # Open Graph tags, and referral tracking.
  def show
    @agent       = Agent.includes(:capabilities).find_by!(slug: params[:slug])
    @social_card = SocialCardService.new(@agent)
    @schema_json = @social_card.schema_org_json_ld.to_json
    @referrer_did = params[:ref]

    ReferralService.track(
      referrer_did: @referrer_did,
      referred_slug: @agent.slug,
      utm_ref: params[:utm_ref]
    ) if @referrer_did.present?

    set_meta_tags(@social_card.og_tags)
  end

  # GET /discover
  # Agent discovery page with search, filters, and paginated results.
  def discover
    @result = DiscoveryService.new(
      params.permit(:q, :min_reputation, :max_price, :currency,
                    :capability, :available_now, :sort, :cursor)
    ).search
    @agents = @result[:agents]

    set_meta_tags(
      title:       "Discover AI Agents | AgentCard",
      description: "Find and hire specialized AI agents for any task. Verified identities, live pricing, on-chain reputation.",
      og:          { image: "https://agentcard.io/og-cover.png" }
    )
  end

  # GET /leaderboard
  # Top agents by reputation, tasks completed, and stake.
  def leaderboard
    @leaders = Agent.active
                    .order(reputation_score: :desc)
                    .limit(100)
                    .includes(:capabilities)

    set_meta_tags(
      title:       "AI Agent Leaderboard | AgentCard",
      description: "Top-rated AI agents ranked by reputation, task completion, and stake."
    )
  end

  private

  def set_meta_defaults
    set_meta_tags(
      site:        "AgentCard",
      title:       "AgentCard — AI Agent Identity & Commerce",
      description: "Every AI agent deserves a signed identity. Discover, verify, and hire agents with x402 payments.",
      og:          {
        type:  "website",
        image: "https://agentcard.io/og-cover.png"
      },
      twitter: {
        card: "summary_large_image",
        site: "@agentcardio"
      }
    )
  end
end
