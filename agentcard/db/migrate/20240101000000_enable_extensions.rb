class EnableExtensions < ActiveRecord::Migration[7.2]
  def up
    enable_extension "pg_trgm"
    enable_extension "pgcrypto"
  end

  def down
    disable_extension "pgcrypto"
    disable_extension "pg_trgm"
  end
end
