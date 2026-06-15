# frozen_string_literal: true

class Capability < ApplicationRecord
  belongs_to :agent

  VALID_CURRENCIES = %w[USDC ETH XRP].freeze
  VALID_PRICING_MODELS = %w[per_request per_hour subscription free].freeze

  validates :capability_id, presence: true
  validates :name, presence: true
  validates :pricing_model,
            presence: true,
            inclusion: { in: VALID_PRICING_MODELS, message: "%{value} is not a valid pricing model" }

  validates :price_amount,
            numericality: { greater_than: 0 },
            allow_nil: true

  validates :price_currency,
            inclusion: { in: VALID_CURRENCIES, message: "%{value} is not a supported currency" },
            allow_nil: true

  validate :price_currency_required_when_amount_present

  # Returns pricing hash in AgentCard spec format
  def pricing_hash
    {
      model: pricing_model,
      amount: price_amount&.to_s,
      currency: price_currency,
      network: network_for_currency(price_currency)
    }.compact
  end

  private

  def price_currency_required_when_amount_present
    if price_amount.present? && price_currency.blank?
      errors.add(:price_currency, "is required when price_amount is set")
    end
  end

  def network_for_currency(currency)
    case currency
    when "USDC" then "ethereum"
    when "ETH"  then "ethereum"
    when "XRP"  then "xrpl"
    end
  end
end
