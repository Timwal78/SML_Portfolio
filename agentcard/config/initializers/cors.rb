# frozen_string_literal: true

# Rack::Cors — Cross-Origin Resource Sharing configuration.
#
# Policy design:
#   - Public API (/api/v1/**, /.well-known/**): open to any origin.
#     Agents and third-party frontends must be able to call us freely.
#   - Profile pages (/a/:slug, /discover, /leaderboard): open for embedding.
#   - Admin / internal routes (if any): restricted to the operator domain.
#
# Credentials (cookies, Authorization headers) are intentionally NOT allowed
# on wildcard-origin requests. If a first-party frontend needs credentialed
# requests, add a dedicated allow block for that origin with credentials: true.

Rails.application.config.middleware.insert_before 0, Rack::Cors do
  # ---------------------------------------------------------------------------
  # Open API — all origins, no credentials
  # ---------------------------------------------------------------------------
  allow do
    origins "*"

    resource "/api/*",
      headers:     :any,
      methods:     %i[get post put patch delete options head],
      expose:      %w[
        X-Request-Id
        X-RateLimit-Limit
        X-RateLimit-Remaining
        X-RateLimit-Reset
        Retry-After
        X-AgentCard-Version
      ],
      max_age:     600

    resource "/.well-known/*",
      headers:     :any,
      methods:     %i[get options head],
      max_age:     3600
  end

  # ---------------------------------------------------------------------------
  # Public HTML profile pages — allow embedding in iframes from any origin
  # ---------------------------------------------------------------------------
  allow do
    origins "*"

    resource "/a/*",
      headers: :any,
      methods: %i[get options head],
      max_age: 600

    resource "/discover",
      headers: :any,
      methods: %i[get options head],
      max_age: 600

    resource "/leaderboard",
      headers: :any,
      methods: %i[get options head],
      max_age: 600
  end

  # ---------------------------------------------------------------------------
  # First-party / operator origins — credentialed requests allowed
  # Add each trusted frontend origin here; never use "*" with credentials: true.
  # ---------------------------------------------------------------------------
  allow do
    origins(
      "https://agentcard.io",
      "https://www.agentcard.io",
      "https://scriptmasterlabs.com",
      "https://www.scriptmasterlabs.com",
      /\Ahttps:\/\/.*\.agentcard\.io\z/,          # staging subdomains
      /\Ahttps:\/\/agentcard-.*\.vercel\.app\z/,  # Vercel preview deployments
      *(Rails.env.development? ? ["http://localhost:3000", "http://localhost:4000", "http://127.0.0.1:3000"] : [])
    )

    resource "*",
      headers:     :any,
      methods:     %i[get post put patch delete options head],
      credentials: true,
      expose:      %w[
        X-Request-Id
        X-AgentCard-Version
        X-RateLimit-Limit
        X-RateLimit-Remaining
      ],
      max_age: 600
  end
end
