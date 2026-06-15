require 'rails_helper'

RSpec.describe 'Api::V1::Agents', type: :request do
  let(:user)  { create(:user) }
  let(:agent) { create(:agent, :with_capability, owner: user) }

  describe 'GET /api/v1/agents' do
    before { agent }

    it 'returns a list of agents' do
      get '/api/v1/agents'
      expect(response).to have_http_status(:ok)
      expect(json_response).to be_an(Array)
    end
  end

  describe 'GET /api/v1/agents/:id' do
    it 'returns the agent card' do
      get "/api/v1/agents/#{agent.id}"
      expect(response).to have_http_status(:ok)
      expect(json_response['did']).to eq(agent.did)
      expect(json_response['name']).to eq(agent.name)
    end

    it 'also resolves by slug' do
      get "/api/v1/agents/#{agent.slug}"
      expect(response).to have_http_status(:ok)
      expect(json_response['did']).to eq(agent.did)
    end

    it 'returns 404 for unknown agent' do
      get '/api/v1/agents/nonexistent-slug'
      expect(response).to have_http_status(:not_found)
    end
  end

  describe 'POST /api/v1/agents' do
    let(:params) do
      {
        agent: {
          name:         'New Agent',
          description:  'A capable agent',
          endpoint_url: 'https://newagent.example.com'
        }
      }
    end

    it 'creates an agent when authenticated' do
      json_post '/api/v1/agents', params:, headers: auth_headers(user)
      expect(response).to have_http_status(:created)
      expect(json_response['name']).to eq('New Agent')
      expect(json_response['did']).to start_with('did:agentcard:')
    end

    it 'returns 401 without authentication' do
      json_post '/api/v1/agents', params:
      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe 'PUT /api/v1/agents/:id' do
    it 'updates the agent for the owner' do
      json_put "/api/v1/agents/#{agent.id}",
               params: { agent: { name: 'Updated Name' } },
               headers: auth_headers(user)
      expect(response).to have_http_status(:ok)
      expect(json_response['name']).to eq('Updated Name')
    end

    it 'rejects updates from non-owners' do
      other_user = create(:user)
      json_put "/api/v1/agents/#{agent.id}",
               params: { agent: { name: 'Hijacked' } },
               headers: auth_headers(other_user)
      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe 'DELETE /api/v1/agents/:id' do
    it 'soft-deactivates the agent' do
      delete "/api/v1/agents/#{agent.id}", headers: auth_headers(user)
      expect(response).to have_http_status(:ok)
      expect(agent.reload.status).to eq('deactivated')
    end
  end

  describe 'POST /api/v1/agents/:id/heartbeat' do
    it 'updates last_seen_at with valid HMAC' do
      headers = agent_hmac_headers(agent, 'POST', "/api/v1/agents/#{agent.id}/heartbeat")
      post "/api/v1/agents/#{agent.id}/heartbeat", headers:
      expect(response).to have_http_status(:ok)
      expect(json_response['status']).to eq('ok')
      expect(agent.reload.last_seen_at).to be_within(5.seconds).of(Time.current)
    end

    it 'returns 401 without HMAC headers' do
      post "/api/v1/agents/#{agent.id}/heartbeat"
      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe 'POST /api/v1/agents/:id/hire' do
    it 'returns 402 with payment requirements' do
      capability = agent.capabilities.first
      json_post "/api/v1/agents/#{agent.id}/hire",
                params: { capability_id: capability.capability_id },
                headers: auth_headers(user)
      expect(response).to have_http_status(:payment_required)
      body = json_response
      expect(body['payment_required']).to be_present
      expect(body['payment_required']['scheme']).to eq('exact')
    end

    it 'is idempotent with same Idempotency-Key' do
      capability = agent.capabilities.first
      headers = auth_headers(user).merge('Idempotency-Key' => 'test-key-123')
      json_post "/api/v1/agents/#{agent.id}/hire",
                params: { capability_id: capability.capability_id },
                headers:
      tx_id = json_response['transaction_id']

      json_post "/api/v1/agents/#{agent.id}/hire",
                params: { capability_id: capability.capability_id },
                headers:
      expect(json_response['transaction_id']).to eq(tx_id)
    end
  end

  describe 'GET /.well-known/agentcard' do
    it 'returns a signed platform AgentCard' do
      get '/.well-known/agentcard'
      expect(response).to have_http_status(:ok)
      expect(response.headers['X-AgentCard-Version']).to eq('1.0')
      body = json_response
      expect(body['schema_version']).to eq('1.0')
      expect(body['capabilities']).to be_an(Array)
    end
  end
end
