class DiscoveryService
  VALID_SORT_FIELDS = %w[reputation_score price_asc price_desc newest most_hired].freeze
  AWAY_THRESHOLD = 5.minutes

  def initialize(params = {})
    @query = params[:q].to_s.strip
    @min_reputation = params[:min_reputation]&.to_f
    @max_price = params[:max_price]&.to_f
    @currency = params[:currency]
    @capability_type = params[:capability]
    @available_now = params[:available_now] == 'true'
    @sort = VALID_SORT_FIELDS.include?(params[:sort]) ? params[:sort] : 'reputation_score'
    @cursor = params[:cursor]
    @per_page = [params[:per_page].to_i.clamp(1, 100), 20].max
  end

  def search
    scope = Agent.includes(:capabilities).where(status: %w[active away])
    scope = apply_text_search(scope)
    scope = apply_filters(scope)
    scope = apply_sort(scope)
    scope = apply_cursor(scope)
    results = scope.limit(@per_page + 1)

    has_next = results.size > @per_page
    items = results.first(@per_page)

    {
      agents: items,
      next_cursor: has_next ? encode_cursor(items.last) : nil,
      facets: build_facets(scope)
    }
  end

  private

  def apply_text_search(scope)
    return scope if @query.blank?
    scope.search_by_text(@query)
  end

  def apply_filters(scope)
    scope = scope.where('reputation_score >= ?', @min_reputation) if @min_reputation
    scope = scope.where('last_seen_at > ?', AWAY_THRESHOLD.ago) if @available_now

    if @max_price || @currency || @capability_type
      scope = scope.joins(:capabilities)
      scope = scope.where('capabilities.price_amount <= ?', @max_price) if @max_price
      scope = scope.where('capabilities.price_currency = ?', @currency) if @currency
      scope = scope.where('capabilities.capability_id = ?', @capability_type) if @capability_type
    end

    scope.distinct
  end

  def apply_sort(scope)
    case @sort
    when 'reputation_score' then scope.order(reputation_score: :desc)
    when 'price_asc'        then scope.joins(:capabilities).order('capabilities.price_amount ASC NULLS LAST')
    when 'price_desc'       then scope.joins(:capabilities).order('capabilities.price_amount DESC NULLS LAST')
    when 'newest'           then scope.order(created_at: :desc)
    when 'most_hired'       then scope.order(completed_tasks: :desc)
    else scope.order(reputation_score: :desc)
    end
  end

  def apply_cursor(scope)
    return scope unless @cursor
    decoded = decode_cursor(@cursor)
    scope.where('reputation_score < ? OR (reputation_score = ? AND id > ?)',
                decoded[:score], decoded[:score], decoded[:id])
  rescue StandardError
    scope
  end

  def encode_cursor(agent)
    Base64.urlsafe_encode64({ score: agent.reputation_score, id: agent.id }.to_json)
  end

  def decode_cursor(cursor)
    JSON.parse(Base64.urlsafe_decode64(cursor)).symbolize_keys
  end

  def build_facets(scope)
    # Strip ORDER BY before using scope as a subquery — PostgreSQL rejects
    # SELECT DISTINCT agents.id ... ORDER BY reputation_score because
    # reputation_score isn't in the subquery SELECT list.
    clean_scope = scope.except(:order)
    {
      capabilities: Capability.joins(:agent).where(agent: clean_scope)
                              .group(:capability_id).count,
      currencies: Capability.joins(:agent).where(agent: clean_scope)
                            .group(:price_currency).count
    }
  end
end
