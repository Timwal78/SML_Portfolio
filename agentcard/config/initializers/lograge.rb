# frozen_string_literal: true

# Lograge — structured JSON logging for production observability.
#
# Replaces Rails' multi-line request logs with a single JSON object per request.
# The JSON payload is shipped to stdout and picked up by log aggregators
# (Datadog, Papertrail, Render log drain, etc.).
#
# Each line includes: method, path, status, duration, db time, view time,
# request_id, user_agent, remote_ip, and filtered params.

Rails.application.configure do
  config.lograge.enabled = true

  # Emit pure JSON — one object per request line
  config.lograge.formatter = Lograge::Formatters::Json.new

  # Keep controller and action in the payload for debugging
  config.lograge.base_controller_class = "ActionController::API"

  # Suppress the asset pipeline and health check noise
  config.lograge.ignore_actions = ["Rails::HealthController#show"]

  # Custom payload appended to every log line
  config.lograge.custom_options = lambda do |event|
    exceptions = %w[controller action format authenticity_token utf8]

    payload = {
      request_id:  event.payload[:headers]&.env&.dig("action_dispatch.request_id"),
      user_agent:  event.payload[:headers]&.env&.dig("HTTP_USER_AGENT"),
      remote_ip:   event.payload[:headers]&.env&.dig("action_dispatch.remote_ip")&.to_s,
      host:        event.payload[:headers]&.env&.dig("HTTP_HOST"),
      params:      event.payload[:params]
                     &.except(*exceptions)
                     &.to_unsafe_h
                     &.transform_keys(&:to_s)
    }

    # Attach authenticated agent/user id if set by the controller
    if (agent_id = event.payload[:agent_id])
      payload[:agent_id] = agent_id
    end

    if (user_id = event.payload[:user_id])
      payload[:user_id] = user_id
    end

    # Attach exception info when present (5xx responses)
    if (exception = event.payload[:exception_object])
      payload[:error_class]   = exception.class.name
      payload[:error_message] = exception.message
      payload[:error_backtrace] = exception.backtrace&.first(5)
    end

    # Tag the environment for multi-env log aggregation
    payload[:environment] = Rails.env

    payload.compact
  end

  # Also silence Action Cable and Active Storage internal logs in production
  if Rails.env.production?
    config.lograge.ignore_custom = lambda do |event|
      event.payload[:path].to_s.start_with?("/cable", "/rails/active_storage")
    end
  end
end
