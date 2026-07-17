# frozen_string_literal: true

# Lockbox — field-level encryption for sensitive model attributes.
#
# Master key precedence (highest to lowest):
#   1. LOCKBOX_MASTER_KEY environment variable (preferred in production/CI)
#   2. Rails encrypted credentials: credentials.lockbox.master_key
#   3. Raises at boot if neither is present in production
#
# Usage in models:
#   encrypts :api_token
#   encrypts :xrpl_seed, deterministic: false   # non-deterministic (default)
#   blind_index :email_canonical                 # enables exact-match search on encrypted field
#
# Key rotation:
#   Set LOCKBOX_PREVIOUS_MASTER_KEY to the old key when rotating.
#   Lockbox will transparently re-encrypt on next read/write.
#   After migration is complete, remove the previous key env var.

master_key = ENV["LOCKBOX_MASTER_KEY"].presence ||
             Rails.application.credentials.dig(:lockbox, :master_key).presence

if master_key.nil? && Rails.env.production?
  raise <<~MSG
    [Lockbox] LOCKBOX_MASTER_KEY is not set.
    Set the LOCKBOX_MASTER_KEY environment variable or add lockbox.master_key
    to Rails credentials (rails credentials:edit).
    Generate a secure key with: SecureRandom.hex(32)
  MSG
end

# In development and test, fall back to a deterministic dev-only key so
# the app boots without requiring the env var to be set.
# NEVER use this key outside of local development.
dev_fallback_key = "0000000000000000000000000000000000000000000000000000000000000000"

Lockbox.master_key = master_key || dev_fallback_key

# ---------------------------------------------------------------------------
# Key rotation support
# ---------------------------------------------------------------------------
# If a previous master key is set, Lockbox will attempt to decrypt with it
# when decryption with the current key fails, then re-encrypt with the new key.
if (previous_key = ENV["LOCKBOX_PREVIOUS_MASTER_KEY"].presence)
  Lockbox.previous_versions = [{ master_key: previous_key }]
end

# ---------------------------------------------------------------------------
# Default encryption settings
# ---------------------------------------------------------------------------
# Use AES-256-GCM (the Lockbox default). Each encrypted value gets a unique
# random nonce — do NOT set a fixed nonce globally.
Lockbox.default_options = {
  encode: true   # store as Base64 string (compatible with text/string DB columns)
}

# ---------------------------------------------------------------------------
# BlindIndex configuration (for searchable encrypted fields)
# ---------------------------------------------------------------------------
# Blind index key is derived from the master key by default in Lockbox 1.x+.
# Set an explicit key here if you need to rotate BlindIndex independently.
#
# BlindIndex.master_key = ENV.fetch("BLIND_INDEX_MASTER_KEY", master_key || dev_fallback_key)

# ---------------------------------------------------------------------------
# Log a warning (never the key itself) so operators know encryption is active
# ---------------------------------------------------------------------------
if master_key.present?
  Rails.logger.info("[Lockbox] Field-level encryption active. Key fingerprint: #{master_key[0, 8]}****")
else
  Rails.logger.warn("[Lockbox] Using dev-only fallback key. Set LOCKBOX_MASTER_KEY before deploying.")
end
