class JsonSchemaValidator
  AGENTCARD_SCHEMA = {
    "type" => "object",
    "required" => %w[schema_version did name description endpoint capabilities authentication payment reputation],
    "additionalProperties" => false,
    "properties" => {
      "schema_version" => { "type" => "string", "enum" => ["1.0"] },
      "did" => { "type" => "string", "pattern" => "^did:agentcard:[a-f0-9]{32}$" },
      "name" => { "type" => "string", "minLength" => 1, "maxLength" => 200 },
      "description" => { "type" => "string", "maxLength" => 2000 },
      "endpoint" => { "type" => "string", "format" => "uri" },
      "capabilities" => {
        "type" => "array",
        "items" => {
          "type" => "object",
          "required" => %w[id name pricing],
          "properties" => {
            "id" => { "type" => "string" },
            "name" => { "type" => "string" },
            "description" => { "type" => "string" },
            "input_schema" => { "type" => "object" },
            "output_schema" => { "type" => "object" },
            "pricing" => {
              "type" => "object",
              "required" => %w[model amount currency network],
              "properties" => {
                "model" => { "type" => "string" },
                "amount" => { "type" => "string" },
                "currency" => { "type" => "string" },
                "network" => { "type" => "string" }
              }
            }
          }
        }
      },
      "authentication" => { "type" => "object" },
      "payment" => { "type" => "object" },
      "reputation" => { "type" => "object" },
      "signature" => { "type" => "string" }
    }
  }.freeze

  def self.validate_card!(payload)
    errors = JSON::Validator.fully_validate(AGENTCARD_SCHEMA, payload)
    raise ValidationError.new(errors) if errors.any?
    true
  end

  def self.valid_card?(payload)
    validate_card!(payload)
    true
  rescue ValidationError
    false
  end

  class ValidationError < StandardError
    attr_reader :errors

    def initialize(errors)
      @errors = errors
      super("AgentCard validation failed: #{errors.join(', ')}")
    end
  end
end
