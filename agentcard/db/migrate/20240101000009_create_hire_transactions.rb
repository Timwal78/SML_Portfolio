class CreateHireTransactions < ActiveRecord::Migration[7.2]
  def change
    create_table :hire_transactions do |t|
      t.references :agent, null: false, foreign_key: true
      t.string :client_wallet_address
      t.string :capability_id, null: false
      t.jsonb :payload, default: {}
      t.string :status, default: "pending"
      t.string :payment_tx_hash
      t.decimal :amount, precision: 36, scale: 18
      t.string :currency
      t.string :idempotency_key
      t.jsonb :result, default: {}

      t.timestamps
    end

    add_index :hire_transactions, :idempotency_key, unique: true
  end
end
