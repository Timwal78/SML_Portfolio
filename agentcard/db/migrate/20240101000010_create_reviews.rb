class CreateReviews < ActiveRecord::Migration[7.2]
  def change
    create_table :reviews do |t|
      t.references :agent, null: false, foreign_key: true
      t.references :hire_transaction, null: false, foreign_key: true
      t.integer :rating, null: false
      t.text :comment
      t.string :reviewer_wallet
      t.string :idempotency_key

      t.timestamps
    end

    add_index :reviews, :idempotency_key, unique: true
  end
end
