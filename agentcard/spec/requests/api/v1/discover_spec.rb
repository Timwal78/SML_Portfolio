require 'rails_helper'

RSpec.describe 'Api::V1::Discover', type: :request do
  let!(:high_rep)  { create(:agent, :with_capability, :available, reputation_score: 4.8) }
  let!(:low_rep)   { create(:agent, :with_capability, :available, reputation_score: 2.1) }
  let!(:away_agent) { create(:agent, :away) }

  describe 'GET /api/v1/discover' do
    it 'returns a list of agents with next_cursor and facets' do
      get '/api/v1/discover'
      expect(response).to have_http_status(:ok)
      body = json_response
      expect(body['agents']).to be_an(Array)
      expect(body).to have_key('next_cursor')
      expect(body).to have_key('facets')
    end

    it 'filters by min_reputation' do
      get '/api/v1/discover', params: { min_reputation: '4.0' }
      dids = json_response['agents'].map { |a| a['did'] }
      expect(dids).to include(high_rep.did)
      expect(dids).not_to include(low_rep.did)
    end

    it 'filters by available_now=true' do
      get '/api/v1/discover', params: { available_now: 'true' }
      slugs = json_response['agents'].map { |a| a.dig('name') }
      expect(json_response['agents']).not_to be_empty
    end

    it 'sorts by reputation_score descending by default' do
      get '/api/v1/discover'
      scores = json_response['agents'].map { |a| a.dig('reputation', 'score') }.compact
      expect(scores).to eq(scores.sort.reverse)
    end

    it 'returns 200 for text search query' do
      get '/api/v1/discover', params: { q: 'agent' }
      expect(response).to have_http_status(:ok)
    end
  end

  describe 'GET /api/v1/directory' do
    it 'returns limited public fields only' do
      get '/api/v1/directory'
      expect(response).to have_http_status(:ok)
      agents = json_response['agents']
      expect(agents.first.keys).to include('did', 'name', 'slug', 'reputation_score', 'status')
      expect(agents.first.keys).not_to include('capabilities', 'payment')
    end
  end

  describe 'GET /api/v1/leaderboard' do
    it 'returns ranked agents' do
      get '/api/v1/leaderboard'
      expect(response).to have_http_status(:ok)
      body = json_response
      expect(body['leaderboard']).to be_an(Array)
      expect(body['leaderboard'].first['rank']).to eq(1)
    end

    it 'filters by category' do
      get '/api/v1/leaderboard', params: { category: 'all' }
      expect(response).to have_http_status(:ok)
    end
  end
end
