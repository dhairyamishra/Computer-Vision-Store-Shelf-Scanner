import { PGlite } from "@electric-sql/pglite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type DatabaseOptions =
  { mode: "memory"; directory?: never } | { directory: string; mode?: never };

export const DEFAULT_DATA_DIRECTORY =
  process.env.SHELF_AUDIT_DATA_DIRECTORY ??
  fileURLToPath(new URL("../../../../data", import.meta.url));
export const DEFAULT_DATABASE_DIRECTORY = join(
  DEFAULT_DATA_DIRECTORY,
  "pgdata",
);

export async function createDatabase(
  options: DatabaseOptions,
): Promise<PGlite> {
  if (options.mode === "memory") {
    return new PGlite();
  }
  await mkdir(options.directory, { recursive: true });
  return new PGlite(options.directory);
}

export async function createLocalDatabase(): Promise<PGlite> {
  return createDatabase({ directory: DEFAULT_DATABASE_DIRECTORY });
}
