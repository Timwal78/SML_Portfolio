class Referral < ApplicationRecord
  validates :referrer_did, presence: true

  def discount_bps
    earned_discount_bps.to_i
  end
end
