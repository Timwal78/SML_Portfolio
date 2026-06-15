class PaymentService
  PLATFORM_FEE_BPS = 250  # 2.5%
  FACILITATOR_URL = ENV.fetch('X402_FACILITATOR_URL', 'https://facilitator.agentcard.io')

  def initialize(agent, capability, client_wallet)
    @agent = agent
    @capability = capability
    @client_wallet = client_wallet
  end

  def build_payment_requirements
    {
      scheme: "exact",
      network: "base",
      maxAmountRequired: amount_in_units.to_s,
      resource: "#{ENV.fetch('APP_URL', 'https://agentcard.io')}/api/v1/agents/#{@agent.id}/hire",
      description: "Hire #{@agent.name} for #{@capability.name}",
      mimeType: "application/json",
      payTo: @agent.endpoint_url,
      maxTimeoutSeconds: 300,
      asset: usdc_contract_address,
      extra: {
        name: "AgentCard",
        version: "1.0",
        capability_id: @capability.capability_id,
        platform_fee_bps: PLATFORM_FEE_BPS,
        facilitator: FACILITATOR_URL
      }
    }
  end

  def verify_payment(tx_hash)
    response = Net::HTTP.get_response(
      URI("#{FACILITATOR_URL}/verify/#{tx_hash}")
    )
    return false unless response.code == '200'
    data = JSON.parse(response.body)
    data['verified'] == true &&
      data['amount'].to_d >= amount_in_units &&
      data['asset'] == usdc_contract_address
  end

  def record_platform_fee(tx_hash, gross_amount)
    platform_fee = gross_amount * (PLATFORM_FEE_BPS / 10_000.0)
    AuditLog.log(
      table_name: 'platform_fees',
      record_id: SecureRandom.uuid,
      action: 'fee_collected',
      before: {},
      after: { tx_hash: tx_hash, gross: gross_amount, fee: platform_fee, agent_id: @agent.id },
      actor: Current.actor
    )
    platform_fee
  end

  private

  def amount_in_units
    @capability.price_amount * 1_000_000  # USDC has 6 decimals
  end

  def usdc_contract_address
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"  # USDC on Base
  end
end
