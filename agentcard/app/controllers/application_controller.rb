class ApplicationController < ActionController::API
  include ActionController::HttpAuthentication::Token::ControllerMethods

  before_action :set_request_id
  before_action :set_current_actor

  rescue_from ActiveRecord::RecordNotFound,           with: :not_found
  rescue_from ActiveRecord::RecordInvalid,            with: :unprocessable
  rescue_from JsonSchemaValidator::ValidationError,   with: :schema_invalid
  rescue_from ActionController::ParameterMissing,     with: :bad_request

  private

  def set_request_id
    Current.request_id = request.uuid
    response.set_header('X-Request-Id', request.uuid)
  end

  def set_current_actor
    # Resolved downstream in authenticate_user! or authenticate_agent!
  end

  def authenticate_user!
    token = extract_bearer_token
    @current_user = User.find_by(api_key: token)
    render_unauthorized unless @current_user
    Current.actor = @current_user
  end

  def authenticate_agent!
    # Verify HMAC-SHA256 via X-AgentCard-Signature header.
    # Header format: "<unix_timestamp>:<hex_signature>"
    signature_header = request.headers['X-AgentCard-Signature']
    agent_did        = request.headers['X-Agent-DID']

    render_unauthorized and return unless signature_header.present? && agent_did.present?

    @current_agent = Agent.find_by(did: agent_did)
    render_unauthorized and return unless @current_agent

    timestamp, signature = signature_header.split(':', 2)

    # Reject requests older than 5 minutes to prevent replay attacks
    if (Time.current.to_i - timestamp.to_i).abs > 300
      render json: { error: 'request_expired' }, status: :unauthorized and return
    end

    payload = "#{timestamp}:#{request.method}:#{request.path}:#{request.raw_post}"

    unless CryptoService.hmac_verify(@current_agent.public_key, payload, signature)
      render_unauthorized and return
    end

    Current.actor = @current_agent
  end

  def current_user
    @current_user
  end

  def current_agent
    @current_agent
  end

  def extract_bearer_token
    authenticate_with_http_token { |token, _| token }
  end

  def idempotency_key
    request.headers['Idempotency-Key']
  end

  # ---------------------------------------------------------------------------
  # Error handlers
  # ---------------------------------------------------------------------------

  def not_found
    render json: { error: 'not_found' }, status: :not_found
  end

  def unprocessable(e)
    render json: {
      error:   'validation_failed',
      details: e.record.errors.full_messages
    }, status: :unprocessable_entity
  end

  def schema_invalid(e)
    render json: {
      error:   'schema_invalid',
      details: e.errors
    }, status: :unprocessable_entity
  end

  def bad_request(e)
    render json: {
      error:   'bad_request',
      message: e.message
    }, status: :bad_request
  end

  def render_unauthorized
    render json: { error: 'unauthorized' }, status: :unauthorized
  end

  # ---------------------------------------------------------------------------
  # Security headers — applied after every action
  # ---------------------------------------------------------------------------
  after_action :add_security_headers

  def add_security_headers
    response.set_header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
    response.set_header('X-Content-Type-Options', 'nosniff')
    response.set_header('X-Frame-Options', 'DENY')
    response.set_header('X-XSS-Protection', '1; mode=block')
  end
end
