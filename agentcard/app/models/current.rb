# frozen_string_literal: true

class Current < ActiveSupport::CurrentAttributes
  attribute :actor, :agent, :request_id
end
