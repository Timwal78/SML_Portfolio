class CreateAuditLogs < ActiveRecord::Migration[7.2]
  def change
    create_table :audit_logs do |t|
      t.string :table_name, null: false
      t.string :record_id,  null: false  # string to accommodate integer and UUID PKs
      t.string :action,     null: false
      t.jsonb  :before,     default: {}
      t.jsonb  :after,      default: {}
      t.string :actor_type, null: false
      t.string :actor_id,   null: false  # string to accommodate integer and UUID PKs

      t.datetime :created_at, null: false
    end
  end
end
