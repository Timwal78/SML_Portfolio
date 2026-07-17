class CreateReferrals < ActiveRecord::Migration[7.2]
  def change
    create_table :referrals do |t|
      t.string :referrer_did, null: false
      t.string :referred_slug
      t.string :utm_ref
      t.integer :conversion_count, default: 0
      t.decimal :earned_discount_bps, precision: 5, scale: 2, default: 0

      t.timestamps
    end
  end
end
