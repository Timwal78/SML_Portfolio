class ApplicationJob < ActiveJob::Base
  sidekiq_options retry: 3
  discard_on ActiveJob::DeserializationError
end
