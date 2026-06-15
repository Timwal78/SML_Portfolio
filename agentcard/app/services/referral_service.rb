class ReferralService
  BASE_PLATFORM_FEE_BPS = 250

  def self.track(referrer_did:, referred_slug:, utm_ref: nil)
    return if referrer_did.blank?
    Referral.find_or_create_by(referrer_did: referrer_did, referred_slug: referred_slug) do |r|
      r.utm_ref = utm_ref
    end
  end

  def self.record_conversion(referrer_did:)
    referral = Referral.find_by(referrer_did: referrer_did)
    return unless referral
    referral.increment!(:conversion_count)
    referral.update!(
      earned_discount_bps: [referral.conversion_count * 5, 100].min
    )
  end

  def self.effective_fee_bps(agent_did)
    referral = Referral.find_by(referrer_did: agent_did)
    return BASE_PLATFORM_FEE_BPS unless referral
    [BASE_PLATFORM_FEE_BPS - referral.earned_discount_bps, 0].max
  end
end
