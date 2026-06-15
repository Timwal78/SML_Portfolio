require "active_support/core_ext/integer/time"

Rails.application.configure do
  # ---------------------------------------------------------------------------
  # Core
  # ---------------------------------------------------------------------------
  # Code is not reloaded between requests.
  config.enable_reloading = false

  # Eager load code on boot for performance and copy-on-write efficiency.
  config.eager_load = true

  # Full error reports are disabled and caching is turned on.
  config.consider_all_requests_local = false

  # Ensures that a master key has been made available in ENV["RAILS_MASTER_KEY"],
  # config/master.key, or config/credentials/production.key.
  config.require_master_key = true

  # ---------------------------------------------------------------------------
  # Security
  # ---------------------------------------------------------------------------
  # Force all access to the app over SSL, use Strict-Transport-Security, and
  # use secure cookies.
  config.force_ssl = true

  # Assume all access is happening through a SSL-terminating reverse proxy
  # (Render, Heroku, Fly.io etc. all terminate TLS upstream).
  config.assume_ssl = true

  # HSTS max-age: 2 years. include_subdomains and preload if you control DNS.
  config.ssl_options = {
    hsts: {
      expires:            2.years.to_i,
      include_subdomains: true,
      preload:            true
    }
  }

  # ---------------------------------------------------------------------------
  # Logging — structured JSON for log aggregators
  # ---------------------------------------------------------------------------
  # Write to STDOUT; Render/Heroku/Fly tail it from there.
  config.logger = ActiveSupport::Logger.new($stdout)
                                        .tap  { |l| l.formatter = proc { |_sev, _ts, _prog, msg| "#{msg}\n" } }
                                        .then { |l| ActiveSupport::TaggedLogging.new(l) }

  # Prepend request_id to every log line (supplement to Lograge JSON payload).
  config.log_tags = [:request_id]

  # Suppress verbose deprecation warnings in logs; report via exception tracker instead.
  config.active_support.report_deprecations = false

  # Log level controlled at runtime via RAILS_LOG_LEVEL env var.
  config.log_level = ENV.fetch("RAILS_LOG_LEVEL", "info").to_sym

  # ---------------------------------------------------------------------------
  # Caching
  # ---------------------------------------------------------------------------
  # Use Redis for Rails cache (same Redis instance as Sidekiq; different DB).
  config.cache_store = :redis_cache_store, {
    url:              ENV.fetch("REDIS_URL", "redis://localhost:6379/0"),
    namespace:        "agentcard:cache",
    expires_in:       1.hour,
    race_condition_ttl: 10.seconds,
    error_handler: lambda { |method:, returning:, exception:|
      Rails.logger.error("[Cache] Redis error in #{method}: #{exception.class} — #{exception.message}")
    }
  }

  # ---------------------------------------------------------------------------
  # Active Storage — Amazon S3
  # ---------------------------------------------------------------------------
  # Override the default :local service set in application.rb.
  config.active_storage.service = :amazon

  # Virus scanning: raise on unanalyzed blobs (requires an analysis job).
  # config.active_storage.content_types_to_serve_as_binary = %w[...]

  # ---------------------------------------------------------------------------
  # Action Mailer
  # ---------------------------------------------------------------------------
  config.action_mailer.perform_caching   = false
  config.action_mailer.raise_delivery_errors = true
  config.action_mailer.delivery_method   = :smtp

  config.action_mailer.smtp_settings = {
    address:              ENV.fetch("SMTP_HOST",     "smtp.postmarkapp.com"),
    port:                 ENV.fetch("SMTP_PORT",     "587").to_i,
    user_name:            ENV.fetch("SMTP_USERNAME", ""),
    password:             ENV.fetch("SMTP_PASSWORD", ""),
    authentication:       :plain,
    enable_starttls_auto: true,
    tls:                  ENV.fetch("SMTP_TLS", "false") == "true",
    open_timeout:         5,
    read_timeout:         5
  }

  config.action_mailer.default_url_options = {
    host:     ENV.fetch("APP_HOST",     "agentcard.io"),
    protocol: "https"
  }

  config.action_mailer.default_options = {
    from: ENV.fetch("MAILER_FROM", "AgentCard <no-reply@agentcard.io>")
  }

  # ---------------------------------------------------------------------------
  # Active Job
  # ---------------------------------------------------------------------------
  # Sidekiq is configured globally in application.rb; queue prefix is set there.
  # config.active_job.queue_adapter = :sidekiq  # inherited from application.rb

  # ---------------------------------------------------------------------------
  # Action Dispatch
  # ---------------------------------------------------------------------------
  # Trust X-Forwarded-* headers from the platform's load balancer/proxy.
  # Set to the number of proxies between the internet and your app.
  config.action_dispatch.trusted_proxies =
    ActionDispatch::RemoteIp::TRUSTED_PROXIES + [
      IPAddr.new("10.0.0.0/8"),    # Render private network
      IPAddr.new("172.16.0.0/12"), # Docker / internal
      IPAddr.new("192.168.0.0/16") # Local VPC
    ]

  # ---------------------------------------------------------------------------
  # Active Record
  # ---------------------------------------------------------------------------
  # Do not dump schema after migrations in production.
  config.active_record.dump_schema_after_migration = false

  # Only expose :id in inspect output to prevent PII leaking into logs.
  config.active_record.attributes_for_inspect = [:id]

  # ---------------------------------------------------------------------------
  # Internationalization
  # ---------------------------------------------------------------------------
  config.i18n.fallbacks = true

  # ---------------------------------------------------------------------------
  # Host authorization
  # ---------------------------------------------------------------------------
  # Restrict which Host headers are accepted to prevent DNS rebinding attacks.
  # Extend this list as new hostnames are added.
  config.hosts = [
    ENV.fetch("APP_HOST", "agentcard.io"),
    /\A.*\.agentcard\.io\z/,         # subdomains
    /\A.*\.onrender\.com\z/,         # Render preview URLs
    /\Aagentcard-.*\.vercel\.app\z/, # Vercel preview deployments
    "localhost"                       # kept for smoke-testing in staging
  ]

  # Allow health check to bypass host authorization so load balancers don't 403.
  config.host_authorization = {
    exclude: ->(request) { request.path == "/up" }
  }
end
