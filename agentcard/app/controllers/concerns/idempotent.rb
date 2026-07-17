module Idempotent
  extend ActiveSupport::Concern

  # Returns the raw value of the Idempotency-Key request header, or nil.
  def idempotency_key
    @idempotency_key ||= request.headers['Idempotency-Key']
  end

  # Looks up an existing record by idempotency_key (and any additional
  # finder attrs). If a record is found and a block is given, the block
  # is called with the record. Returns the found record or nil.
  #
  # Usage:
  #   existing = with_idempotency(HireTransaction) do |tx|
  #     return render json: hire_tx_json(tx)
  #   end
  def with_idempotency(model_class, **find_attrs)
    return nil unless idempotency_key

    existing = model_class.find_by(idempotency_key: idempotency_key, **find_attrs)
    yield existing if existing && block_given?
    existing
  end
end
