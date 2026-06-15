# frozen_string_literal: true

# Rack::Attack — request-level rate limiting, blocking, and safelisting.
# All counters are stored in Redis (configured via config.cache_store).
#
# Throttle hierarchy (first match wins within Rack::Attack):
#   1. Safelist (passes immediately)
#   2. Blocklist (rejects immediately with 403)
#   3. Throttle (limits rate, returns 429 on excess)

class Rack::Attack
  # ---------------------------------------------------------------------------
  # Cache store — use Redis so counters survive dyno restarts and are shared
  # across all web workers/processes.
  # ---------------------------------------------------------------------------
  Rack::Attack.cache.store = ActiveSupport::Cache::RedisCacheStore.new(
    url: ENV.fetch("REDIS_URL", "redis://localhost:6379/1"),
    namespace: "rack_attack",
    expires_in: 10.minutes
  )

  # ---------------------------------------------------------------------------
  # Safelist: always allow localhost and internal health probes
  # ---------------------------------------------------------------------------
  safelist("allow-localhost") do |req|
    req.ip == "127.0.0.1" || req.ip == "::1"
  end

  # Allow uptime monitors and load balancer health checks without counting
  safelist("allow-health-check") do |req|
    req.path == "/up"
  end

  # ---------------------------------------------------------------------------
  # Blocklist: repeat offenders
  # Clients that have triggered 10+ throttle events in the last hour are blocked
  # for 24 hours. Their IPs land in the "blocked_ips" Redis key via the
  # throttle_response callback below.
  # ---------------------------------------------------------------------------
  blocklist("block-repeat-offenders") do |req|
    Rack::Attack.cache.store.read("blocked:#{req.ip}") == true
  end

  # ---------------------------------------------------------------------------
  # Throttle: General API — 300 req / 5 min per IP (60 req/min effective)
  # Covers any endpoint not matched by a more specific rule below.
  # ---------------------------------------------------------------------------
  throttle("api/general/ip", limit: 300, period: 5.minutes) do |req|
    req.ip if req.path.start_with?("/api/")
  end

  # ---------------------------------------------------------------------------
  # Throttle: Discovery endpoints — 100 req / min per IP
  # GET /api/v1/discover, GET /api/v1/directory, GET /discover, GET /leaderboard
  # ---------------------------------------------------------------------------
  throttle("api/discover/ip", limit: 100, period: 1.minute) do |req|
    if req.get? && (
        req.path.start_with?("/api/v1/discover") ||
        req.path.start_with?("/api/v1/directory") ||
        req.path.start_with?("/api/v1/leaderboard") ||
        req.path == "/discover" ||
        req.path == "/leaderboard"
      )
      req.ip
    end
  end

  # ---------------------------------------------------------------------------
  # Throttle: Agent creation and AgentCard generation — 10 req / min per IP
  # These are write-heavy / compute-heavy operations.
  # POST /api/v1/agents         — create agent
  # GET  /api/v1/agents/:id/agentcard — generate card
  # ---------------------------------------------------------------------------
  throttle("api/agent-write/ip", limit: 10, period: 1.minute) do |req|
    if (req.post? && req.path == "/api/v1/agents") ||
       (req.get? && req.path.match?(%r{/api/v1/agents/[^/]+/agentcard}))
      req.ip
    end
  end

  # ---------------------------------------------------------------------------
  # Throttle: Hiring and staking — 20 req / min per IP
  # POST /api/v1/agents/:id/hire
  # POST /api/v1/agents/:id/stake
  # ---------------------------------------------------------------------------
  throttle("api/hire-stake/ip", limit: 20, period: 1.minute) do |req|
    if req.post? && req.path.match?(%r{/api/v1/agents/[^/]+/(hire|stake)})
      req.ip
    end
  end

  # ---------------------------------------------------------------------------
  # Throttle: x402 payment endpoints — 1000 req / min per IP
  # Payment probes are high-frequency by design (agents poll for invoice status).
  # ---------------------------------------------------------------------------
  throttle("api/payment/ip", limit: 1000, period: 1.minute) do |req|
    req.ip if req.path.start_with?("/api/v1/payment") || req.path.include?("/x402/")
  end

  # ---------------------------------------------------------------------------
  # Throttle: Heartbeat endpoint — 60 req / min per IP
  # POST /api/v1/agents/:id/heartbeat — agents ping every second in some impls
  # ---------------------------------------------------------------------------
  throttle("api/heartbeat/ip", limit: 60, period: 1.minute) do |req|
    req.ip if req.post? && req.path.match?(%r{/api/v1/agents/[^/]+/heartbeat})
  end

  # ---------------------------------------------------------------------------
  # Throttle: Well-known endpoint — 30 req / min per IP
  # Low-traffic discovery; no need for high limits
  # ---------------------------------------------------------------------------
  throttle("well-known/ip", limit: 30, period: 1.minute) do |req|
    req.ip if req.path.start_with?("/.well-known/")
  end

  # ---------------------------------------------------------------------------
  # Blocklist escalation: track throttle violations and block repeat offenders
  # ---------------------------------------------------------------------------
  # After 10 throttled responses to a single IP within 1 hour, block for 24h.
  throttle("abuse-escalation/ip", limit: 10, period: 1.hour) do |req|
    # This throttle counts how many times an IP has already been throttled.
    # We tag it via the throttle_response callback, not here.
    nil
  end

  # ---------------------------------------------------------------------------
  # Throttle response: JSON 429 with Retry-After header
  # ---------------------------------------------------------------------------
  self.throttled_responder = lambda do |env|
    req        = Rack::Request.new(env)
    match_data = env["rack.attack.match_data"]
    retry_after = match_data ? (match_data[:period] - match_data[:count] % match_data[:period]).to_s : "60"

    # Escalate to blocklist if this IP keeps hitting limits
    violation_key = "throttle_violations:#{req.ip}"
    violations = Rack::Attack.cache.store.increment(violation_key, 1, expires_in: 1.hour) || 1
    if violations >= 10
      Rack::Attack.cache.store.write("blocked:#{req.ip}", true, expires_in: 24.hours)
      Rails.logger.warn("[Rack::Attack] Blocked repeat offender: #{req.ip} (#{violations} violations)")
    end

    body = {
      error:       "rate_limit_exceeded",
      message:     "Too many requests. Please slow down.",
      retry_after: retry_after.to_i
    }.to_json

    [
      429,
      {
        "Content-Type"  => "application/json; charset=utf-8",
        "Retry-After"   => retry_after,
        "X-RateLimit-Limit" => match_data&.dig(:limit).to_s,
        "Cache-Control" => "no-cache, no-store"
      },
      [body]
    ]
  end

  # ---------------------------------------------------------------------------
  # Blocklist response: JSON 403
  # ---------------------------------------------------------------------------
  self.blocklisted_responder = lambda do |env|
    body = {
      error:   "blocked",
      message: "Your IP has been temporarily blocked due to repeated abuse. Contact support if this is an error."
    }.to_json

    [
      403,
      { "Content-Type" => "application/json; charset=utf-8", "Cache-Control" => "no-cache, no-store" },
      [body]
    ]
  end
end

# Log all throttle and blocklist events for observability
ActiveSupport::Notifications.subscribe("throttle.rack_attack") do |_name, _start, _finish, _request_id, payload|
  req = payload[:request]
  Rails.logger.warn("[Rack::Attack] Throttle triggered: #{req.env['rack.attack.matched']} | IP: #{req.ip} | Path: #{req.path}")
end

ActiveSupport::Notifications.subscribe("blocklist.rack_attack") do |_name, _start, _finish, _request_id, payload|
  req = payload[:request]
  Rails.logger.warn("[Rack::Attack] Blocklist triggered: #{req.env['rack.attack.matched']} | IP: #{req.ip} | Path: #{req.path}")
end
