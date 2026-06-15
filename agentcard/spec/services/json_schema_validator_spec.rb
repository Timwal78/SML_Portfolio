require 'rails_helper'

RSpec.describe JsonSchemaValidator do
  let(:valid_card) do
    {
      "schema_version" => "1.0",
      "did"            => "did:agentcard:#{SecureRandom.hex(16)}",
      "name"           => "Test Agent",
      "description"    => "A test agent",
      "endpoint"       => "https://example.com",
      "capabilities"   => [
        {
          "id"     => "code_review",
          "name"   => "Code Review",
          "pricing" => {
            "model"    => "per_request",
            "amount"   => "0.05",
            "currency" => "USDC",
            "network"  => "base"
          }
        }
      ],
      "authentication" => { "type" => "api_key" },
      "payment"        => { "protocol" => "x402" },
      "reputation"     => { "score" => 4.5 }
    }
  end

  describe '.validate_card!' do
    it 'accepts a valid AgentCard payload' do
      expect { described_class.validate_card!(valid_card) }.not_to raise_error
    end

    it 'raises ValidationError when schema_version is missing' do
      expect {
        described_class.validate_card!(valid_card.except('schema_version'))
      }.to raise_error(JsonSchemaValidator::ValidationError)
    end

    it 'raises ValidationError for invalid DID format' do
      bad_card = valid_card.merge('did' => 'not-a-valid-did')
      expect {
        described_class.validate_card!(bad_card)
      }.to raise_error(JsonSchemaValidator::ValidationError)
    end

    it 'raises ValidationError for wrong schema_version' do
      bad_card = valid_card.merge('schema_version' => '2.0')
      expect {
        described_class.validate_card!(bad_card)
      }.to raise_error(JsonSchemaValidator::ValidationError)
    end
  end

  describe '.valid_card?' do
    it 'returns true for a valid card' do
      expect(described_class.valid_card?(valid_card)).to be true
    end

    it 'returns false for an invalid card' do
      expect(described_class.valid_card?({})).to be false
    end
  end

  describe 'ValidationError' do
    it 'exposes errors array' do
      begin
        described_class.validate_card!({})
      rescue JsonSchemaValidator::ValidationError => e
        expect(e.errors).to be_an(Array)
        expect(e.errors).not_to be_empty
      end
    end
  end
end
