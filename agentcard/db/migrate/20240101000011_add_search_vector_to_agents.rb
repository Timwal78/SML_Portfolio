class AddSearchVectorToAgents < ActiveRecord::Migration[7.2]
  def up
    add_column :agents, :search_vector, :tsvector

    add_index :agents, :search_vector, using: :gin

    execute <<-SQL
      CREATE OR REPLACE FUNCTION agents_search_vector_update()
      RETURNS trigger AS $$
      BEGIN
        NEW.search_vector :=
          to_tsvector('english',
            coalesce(NEW.name, '') || ' ' || coalesce(NEW.description, '')
          );
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER agents_search_vector_trigger
      BEFORE INSERT OR UPDATE ON agents
      FOR EACH ROW
      EXECUTE FUNCTION agents_search_vector_update();

      UPDATE agents SET search_vector =
        to_tsvector('english',
          coalesce(name, '') || ' ' || coalesce(description, '')
        );
    SQL
  end

  def down
    execute <<-SQL
      DROP TRIGGER IF EXISTS agents_search_vector_trigger ON agents;
      DROP FUNCTION IF EXISTS agents_search_vector_update();
    SQL

    remove_index :agents, :search_vector
    remove_column :agents, :search_vector
  end
end
