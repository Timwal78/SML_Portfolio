class CreateReputationEvents < ActiveRecord::Migration[7.2]
  def change
    create_table :reputation_events do |t|
      t.references :agent, null: false, foreign_key: true
      t.string :event_type, null: false
      t.decimal :score_delta, precision: 3, scale: 2
      t.decimal :new_score, precision: 3, scale: 2
      t.jsonb :metadata, default: {}
      t.string :tx_hash

      t.datetime :created_at, null: false
    end
  end
end
