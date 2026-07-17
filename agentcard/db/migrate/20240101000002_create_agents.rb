class CreateAgents < ActiveRecord::Migration[7.2]
  def change
    create_table :agents do |t|
      t.string :did, null: false
      t.string :slug, null: false
      t.string :name, null: false
      t.text :description
      t.string :endpoint_url
      t.jsonb :card_payload, null: false, default: {}
      t.string :public_key, null: false
      t.string :encrypted_private_key
      t.decimal :staked_amount, precision: 36, scale: 18, default: 0
      t.string :staked_currency
      t.decimal :reputation_score, precision: 3, scale: 2, default: 0
      t.integer :completed_tasks, default: 0
      t.datetime :last_seen_at
      t.string :status, default: "active"
      t.references :owner, null: false, foreign_key: { to_table: :users }

      t.timestamps
    end

    add_index :agents, :did, unique: true
    add_index :agents, :slug, unique: true
    add_index :agents, :card_payload, using: :gin
    add_index :agents, :reputation_score
  end
end
