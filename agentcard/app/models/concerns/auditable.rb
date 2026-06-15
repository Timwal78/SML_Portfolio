# frozen_string_literal: true

module Auditable
  extend ActiveSupport::Concern

  included do
    after_create  :audit_create
    after_update  :audit_update
    after_destroy :audit_destroy
  end

  private

  def audit_create
    AuditLog.log(
      table_name: self.class.table_name,
      record_id: id.to_s,
      action: "create",
      before: {},
      after: audit_attributes,
      actor: current_actor
    )
  rescue StandardError => e
    Rails.logger.error("[Auditable#audit_create] #{self.class.name}##{id}: #{e.message}")
  end

  def audit_update
    return if previous_changes.empty?

    before_attrs = {}
    after_attrs = {}

    previous_changes.each do |attr, (before_val, after_val)|
      next if attr == "updated_at"
      before_attrs[attr] = before_val
      after_attrs[attr] = after_val
    end

    return if before_attrs.empty?

    AuditLog.log(
      table_name: self.class.table_name,
      record_id: id.to_s,
      action: "update",
      before: before_attrs,
      after: after_attrs,
      actor: current_actor
    )
  rescue StandardError => e
    Rails.logger.error("[Auditable#audit_update] #{self.class.name}##{id}: #{e.message}")
  end

  def audit_destroy
    AuditLog.log(
      table_name: self.class.table_name,
      record_id: id.to_s,
      action: "destroy",
      before: audit_attributes,
      after: {},
      actor: current_actor
    )
  rescue StandardError => e
    Rails.logger.error("[Auditable#audit_destroy] #{self.class.name}##{id}: #{e.message}")
  end

  def current_actor
    Current.actor
  rescue NameError
    nil
  end

  def audit_attributes
    attrs = attributes.dup
    # Scrub sensitive fields from audit records
    %w[encrypted_password otp_secret api_key encrypted_private_key].each do |sensitive|
      attrs[sensitive] = "[REDACTED]" if attrs.key?(sensitive)
    end
    attrs
  end
end
