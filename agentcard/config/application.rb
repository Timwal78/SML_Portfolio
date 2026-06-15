require_relative "boot"

require "rails"
# Pick the frameworks you want:
require "active_model/railtie"
require "active_job/railtie"
require "active_record/railtie"
require "active_storage/engine"
require "action_controller/railtie"
require "action_mailer/railtie"
require "action_mailbox/engine"
require "action_text/engine"
require "action_view/railtie"
require "action_cable/engine"

# Require the gems listed in Gemfile, including any gems
# you've limited to :test, :development, or :production.
Bundler.require(*Rails.groups)

module Agentcard
  class Application < Rails::Application
    # Initialize configuration defaults for originally generated Rails version.
    config.load_defaults 7.2

    # Please, add to the `ignore` list any other `lib` subdirectories that do
    # not contain `.rb` files, or that should not be reloaded or eager loaded.
    config.autoload_lib(ignore: %w[assets tasks])

    # ---------------------------------------------------------------------------
    # API mode with selective HTML page support
    # ---------------------------------------------------------------------------
    # We operate primarily as a JSON API, but profile pages (/a/:slug, /discover,
    # /leaderboard) render HTML via ActionView. api_only = true removes ActionView
    # from the middleware stack, so we add back what we need selectively.
    config.api_only = true

    # Re-add middleware required for HTML-rendering profile controllers and the
    # well-known endpoint (cookies + session needed for flash on error pages).
    config.middleware.use ActionDispatch::Cookies
    config.middleware.use ActionDispatch::Session::CookieStore,
      key: "_agentcard_session",
      secure: Rails.env.production?,
      same_site: :lax,
      expire_after: 2.hours

    # Flash messages used by profile page error states
    config.middleware.use ActionDispatch::Flash

    # ---------------------------------------------------------------------------
    # Background jobs
    # ---------------------------------------------------------------------------
    config.active_job.queue_adapter = :sidekiq
    config.active_job.queue_name_prefix = "agentcard_#{Rails.env}"

    # ---------------------------------------------------------------------------
    # Action Mailer
    # ---------------------------------------------------------------------------
    config.action_mailer.default_url_options = {
      host: ENV.fetch("APP_HOST", "agentcard.io"),
      protocol: "https"
    }
    config.action_mailer.default_options = {
      from: ENV.fetch("MAILER_FROM", "AgentCard <no-reply@agentcard.io>")
    }

    # ---------------------------------------------------------------------------
    # Time zone
    # ---------------------------------------------------------------------------
    config.time_zone = "UTC"
    config.active_record.default_timezone = :utc

    # ---------------------------------------------------------------------------
    # Logging
    # ---------------------------------------------------------------------------
    config.log_level = ENV.fetch("RAILS_LOG_LEVEL", "info").to_sym

    # ---------------------------------------------------------------------------
    # Locales
    # ---------------------------------------------------------------------------
    config.i18n.default_locale = :en
    config.i18n.available_locales = [:en]

    # ---------------------------------------------------------------------------
    # Active Storage
    # ---------------------------------------------------------------------------
    # Default to local; overridden to :amazon in production.rb
    config.active_storage.service = :local

    # ---------------------------------------------------------------------------
    # Security: filter sensitive params from logs
    # ---------------------------------------------------------------------------
    config.filter_parameters += %i[
      passw secret token _key salt certificate otp ssn
      payment_token private_key seed wallet_seed
    ]

    # ---------------------------------------------------------------------------
    # Eager load paths
    # ---------------------------------------------------------------------------
    config.eager_load_paths << Rails.root.join("lib")
  end
end
