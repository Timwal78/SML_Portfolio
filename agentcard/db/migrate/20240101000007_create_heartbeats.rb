class CreateHeartbeats < ActiveRecord::Migration[7.2]
  def change
    create_table :heartbeats do |t|
      t.references :agent, null: false, foreign_key: true
      t.string :ip_address

      t.datetime :created_at, null: false
    end

    add_index :heartbeats, [:agent_id, :created_at]
  end
end
