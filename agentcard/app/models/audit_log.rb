# frozen_string_literal: true

class AuditLog < ApplicationRecord
  # Audit logs are append-only — no updated_at column
  self.record_timestamps = false

  belongs_to :actor, polymorphic: true, optional: true

  validates :table_name, presence: true
  validates :record_id, presence: true
  validates :action, presence: true
  validates :actor_type, presence: true
  validates :actor_id, presence: true

  # Actions are open-ended to support domain-specific events beyond CRUD
  # (e.g. 'deactivate', 'fee_collected', 'stake_added', 'daily_anchor').

  # Class-level factory method for creating audit records
  def self.log(table_name:, record_id:, action:, before: {}, after: {}, actor: nil)
    actor_type = actor&.class&.name || "System"
    actor_id = actor&.id || "00000000-0000-0000-0000-000000000000"

    create!(
      table_name: table_name,
      record_id: record_id.to_s,
      action: action,
      before: before || {},
      after: after || {},
      actor_type: actor_type,
      actor_id: actor_id.to_s,
      created_at: Time.current
    )
  rescue ActiveRecord::RecordInvalid => e
    Rails.logger.error("[AuditLog.log] Failed to create audit log: #{e.message}")
    nil
  end

  # Prevent mutations on audit logs — they are immutable
  def update(*)
    raise ActiveRecord::ReadOnlyRecord, "AuditLog records are immutable"
  end

  def update!(*)
    raise ActiveRecord::ReadOnlyRecord, "AuditLog records are immutable"
  end

  def destroy
    raise ActiveRecord::ReadOnlyRecord, "AuditLog records cannot be destroyed"
  end

  def destroy!
    raise ActiveRecord::ReadOnlyRecord, "AuditLog records cannot be destroyed"
  end
end
