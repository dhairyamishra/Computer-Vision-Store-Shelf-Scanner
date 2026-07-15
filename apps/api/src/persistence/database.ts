import { PGlite } from "@electric-sql/pglite";
import { resolve } from "node:path";

export type DatabaseOptions =
  { mode: "memory"; directory?: never } | { directory: string; mode?: never };

export const DEFAULT_DATABASE_DIRECTORY = resolve(
  process.cwd(),
  "data",
  "pgdata",
);

export async function createDatabase(
  options: DatabaseOptions,
): Promise<PGlite> {
  return options.mode === "memory"
    ? new PGlite()
    : new PGlite(options.directory);
}

export async function createLocalDatabase(): Promise<PGlite> {
  return createDatabase({ directory: DEFAULT_DATABASE_DIRECTORY });
}
