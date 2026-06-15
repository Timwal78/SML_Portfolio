# frozen_string_literal: true

class Delegation < ApplicationRecord
  belongs_to :agent

  validates :delegate_did, presence: true
  validates :scope, presence: true
  validates :proof_signature, presence: true

  scope :active, -> { where("expires_at IS NULL OR expires_at > ?", Time.current) }
  scope :for_did, ->(did) { where(delegate_did: did) }

  # Returns true if this delegation has passed its expiry time
  def expired?
    expires_at.present? && expires_at < Time.current
  end

  # Returns true if the required_scope is covered by this delegation's scope
  # Scope is stored as space-separated permission strings (e.g. "read write execute")
  def valid_scope?(required_scope)
    return false if scope.blank? || required_scope.blank?
    return false if expired?

    granted_scopes = scope.split
    required_scopes = required_scope.to_s.split

    required_scopes.all? { |rs| granted_scopes.include?(rs) }
  end
end
