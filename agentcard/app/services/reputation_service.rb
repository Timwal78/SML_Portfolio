class ReputationService
  STAKE_TIERS = {
    0      => { badge: 'unverified', discount_bps: 0 },
    100    => { badge: 'bronze',     discount_bps: 50 },
    500    => { badge: 'silver',     discount_bps: 100 },
    2000   => { badge: 'gold',       discount_bps: 200 },
    10_000 => { badge: 'platinum',   discount_bps: 300 }
  }.freeze

  def initialize(agent)
    @agent = agent
  end

  def record_review(rating:, reviewer:, hire_transaction:)
    delta = calculate_delta(rating)
    event = @agent.reputation_events.create!(
      event_type: 'review_received',
      score_delta: delta,
      new_score: recalculate_score,
      metadata: {
        rating: rating,
        reviewer: reviewer,
        hire_transaction_id: hire_transaction.id,
        capability_id: hire_transaction.capability_id
      }
    )
    update_agent_score
    event
  end

  def record_task_completed(hire_transaction:)
    @agent.increment!(:completed_tasks)
    @agent.reputation_events.create!(
      event_type: 'task_completed',
      score_delta: 0,
      new_score: @agent.reputation_score,
      metadata: { hire_transaction_id: hire_transaction.id }
    )
  end

  def add_stake(amount:, currency:, tx_hash:)
    new_total = (@agent.staked_amount || 0) + amount
    @agent.update!(staked_amount: new_total, staked_currency: currency)
    @agent.reputation_events.create!(
      event_type: 'stake_added',
      score_delta: 0,
      new_score: @agent.reputation_score,
      metadata: { amount: amount, currency: currency, tx_hash: tx_hash, total: new_total }
    )
    AuditLog.log(
      table_name: 'agents', record_id: @agent.id,
      action: 'stake_added',
      before: { staked_amount: (@agent.staked_amount - amount).to_s },
      after: { staked_amount: new_total.to_s, tx_hash: tx_hash },
      actor: Current.actor
    )
  end

  def stake_badge
    tier = STAKE_TIERS.keys.select { |k| (@agent.staked_amount || 0) >= k }.max
    STAKE_TIERS[tier][:badge]
  end

  def contextual_score(capability_id)
    events = @agent.reputation_events
                   .where(event_type: 'review_received')
                   .where("metadata->>'capability_id' = ?", capability_id)
    return @agent.reputation_score if events.empty?
    ratings = events.pluck(Arel.sql("(metadata->>'rating')::numeric"))
    ratings.sum / ratings.size.to_f
  end

  private

  def calculate_delta(rating)
    (rating - 3.0) * 0.1
  end

  def recalculate_score
    reviews = @agent.reputation_events.where(event_type: 'review_received')
    return 0.0 if reviews.empty?
    avg = reviews.average(:new_score)&.to_f || 0.0
    avg.clamp(0.0, 5.0).round(2)
  end

  def update_agent_score
    new_score = recalculate_score
    @agent.update_column(:reputation_score, new_score)
  end
end
