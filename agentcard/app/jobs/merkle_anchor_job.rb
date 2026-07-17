class MerkleAnchorJob < ApplicationJob
  queue_as :low

  def perform
    agents = Agent.active.order(:id).pluck(:did, :reputation_score, :completed_tasks)

    leaves = agents.map do |did, score, tasks|
      Digest::SHA256.hexdigest("#{did}:#{score}:#{tasks}")
    end

    merkle_root = compute_merkle_root(leaves)

    AuditLog.log(
      table_name: "merkle_anchors",
      record_id: SecureRandom.uuid,
      action: "daily_anchor",
      before: {},
      after: {
        merkle_root:,
        agent_count: agents.size,
        anchored_at: Time.current.iso8601,
        chain: "base",
        status: "logged"
      },
      actor: nil
    )

    Rails.logger.info "[MerkleAnchorJob] Merkle root #{merkle_root} for #{agents.size} agents"
  end

  private

  def compute_merkle_root(leaves)
    return Digest::SHA256.hexdigest("empty") if leaves.empty?

    layer = leaves
    while layer.size > 1
      layer = layer.each_slice(2).map { |a, b| Digest::SHA256.hexdigest(a + (b || a)) }
    end
    layer.first
  end
end
