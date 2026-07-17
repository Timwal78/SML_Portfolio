class CreateCapabilities < ActiveRecord::Migration[7.2]
  def change
    create_table :capabilities do |t|
      t.references :agent, null: false, foreign_key: true
      t.string :capability_id, null: false
      t.string :name, null: false
      t.text :description
      t.jsonb :input_schema, default: {}
      t.jsonb :output_schema, default: {}
      t.string :pricing_model
      t.decimal :price_amount, precision: 36, scale: 18
      t.string :price_currency

      t.timestamps
    end
  end
end
