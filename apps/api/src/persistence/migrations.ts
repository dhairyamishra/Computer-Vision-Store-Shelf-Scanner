import type { PGlite } from "@electric-sql/pglite";

const migrations = [
  {
    id: "001_initial_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        external_identifier TEXT NOT NULL UNIQUE,
        region TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        brand TEXT NOT NULL,
        product TEXT NOT NULL,
        variant TEXT,
        size TEXT,
        pack TEXT,
        aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
        reference_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS account_assortments (
        account_id TEXT NOT NULL REFERENCES accounts(id),
        product_id TEXT NOT NULL REFERENCES products(id),
        expected_presence BOOLEAN NOT NULL DEFAULT TRUE,
        expected_facings INTEGER CHECK (expected_facings IS NULL OR expected_facings >= 0),
        expected_shelf_position TEXT,
        expected_price_cents INTEGER CHECK (expected_price_cents IS NULL OR expected_price_cents >= 0),
        PRIMARY KEY (account_id, product_id)
      );

      CREATE TABLE IF NOT EXISTS audit_runs (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        status TEXT NOT NULL,
        source_video_path TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        schema_version TEXT NOT NULL DEFAULT '1.0',
        prompt_version TEXT,
        pipeline_version TEXT NOT NULL DEFAULT '1.0',
        stage_latencies JSONB NOT NULL DEFAULT '{}'::jsonb,
        error_code TEXT,
        error_message TEXT,
        raw_provider_response JSONB,
        final_audit JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS audit_runs_account_id_idx ON audit_runs(account_id);
      CREATE INDEX IF NOT EXISTS audit_runs_status_idx ON audit_runs(status);
    `,
  },
  {
    id: "002_processing_metadata",
    sql: `
      ALTER TABLE audit_runs
      ADD COLUMN IF NOT EXISTS processing_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
    `,
  },
] as const;

export async function migrateDatabase(database: PGlite): Promise<void> {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  for (const migration of migrations) {
    const existing = await database.query<{ id: string }>(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [migration.id],
    );

    if (existing.rows.length === 0) {
      await database.transaction(async (transaction) => {
        await transaction.exec(migration.sql);
        await transaction.query(
          "INSERT INTO schema_migrations (id) VALUES ($1)",
          [migration.id],
        );
      });
    }
  }
}
