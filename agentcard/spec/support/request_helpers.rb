module RequestHelpers
  def json_response
    JSON.parse(response.body)
  end

  def auth_headers(user)
    { 'Authorization' => "Bearer #{user.api_key}", 'Content-Type' => 'application/json' }
  end

  def agent_hmac_headers(agent, http_method, path, body = '')
    timestamp = Time.current.to_i.to_s
    payload   = "#{timestamp}:#{http_method.upcase}:#{path}:#{body}"
    sig       = CryptoService.hmac_sign(agent.public_key, payload)
    {
      'X-AgentCard-Signature' => "#{timestamp}:#{sig}",
      'X-Agent-DID'           => agent.did,
      'Content-Type'          => 'application/json'
    }
  end

  def json_post(path, params: {}, headers: {})
    post path, params: params.to_json, headers: headers.merge('Content-Type' => 'application/json')
  end

  def json_put(path, params: {}, headers: {})
    put path, params: params.to_json, headers: headers.merge('Content-Type' => 'application/json')
  end
end
