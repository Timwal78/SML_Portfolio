class CreateUsers < ActiveRecord::Migration[7.2]
  def change
    create_table :users do |t|
      t.string  :email,              null: false
      t.string  :password_digest,    null: false  # bcrypt via has_secure_password
      t.string  :otp_secret
      t.boolean :otp_enabled,        default: false
      t.string  :api_key
      t.boolean :weekly_digest,      default: true, null: false  # email digest opt-in

      t.timestamps
    end

    add_index :users, :email, unique: true
    add_index :users, :api_key, unique: true
  end
end
