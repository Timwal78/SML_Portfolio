class CreateDelegations < ActiveRecord::Migration[7.2]
  def change
    create_table :delegations do |t|
      t.references :agent, null: false, foreign_key: true
      t.string :delegate_did, null: false
      t.string :scope, null: false
      t.datetime :expires_at
      t.string :proof_signature, null: false

      t.timestamps
    end
  end
end
