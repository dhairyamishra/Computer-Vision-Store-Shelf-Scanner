import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LocalMediaStore,
  PGliteAuditRepository,
  createDatabase,
  migrateDatabase,
  seedDemoData,
} from "../src/persistence/index.js";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("PGlite persistence", () => {
  it("applies migrations to a fresh database and seeds demo data idempotently", async () => {
    const database = await createDatabase({ mode: "memory" });

    try {
      await migrateDatabase(database);
      await seedDemoData(database);
      await seedDemoData(database);

      const repository = new PGliteAuditRepository(database);
      const accounts = await repository.listAccounts();
      const assortment = await repository.listAccountAssortment(accounts[0].id);

      expect(accounts).toHaveLength(2);
      expect(assortment).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ expectedPresence: true }),
        ]),
      );
    } finally {
      await database.close();
    }
  });

  it("persists an audit after closing and reopening a file-backed database", async () => {
    const directory = await createTemporaryDirectory("shelf-audit-db-");
    const firstDatabase = await createDatabase({ directory });

    await migrateDatabase(firstDatabase);
    await seedDemoData(firstDatabase);
    const firstRepository = new PGliteAuditRepository(firstDatabase);
    const account = (await firstRepository.listAccounts())[0];
    const audit = await firstRepository.createAudit({
      id: "audit-persisted",
      accountId: account.id,
      sourceVideoPath: "uploads/audit-persisted.mp4",
      provider: "fixture",
      model: "fixture-v1",
    });

    await firstRepository.transitionAudit(audit.id, "uploading");
    await firstRepository.transitionAudit(audit.id, "uploaded");
    await firstDatabase.close();

    const reopenedDatabase = await createDatabase({ directory });
    try {
      const reopenedRepository = new PGliteAuditRepository(reopenedDatabase);
      await expect(
        reopenedRepository.getAudit(audit.id),
      ).resolves.toMatchObject({
        id: audit.id,
        accountId: account.id,
        status: "uploaded",
        sourceVideoPath: "uploads/audit-persisted.mp4",
      });
    } finally {
      await reopenedDatabase.close();
    }
  });

  it("rejects invalid audit state transitions and recovers abandoned work", async () => {
    const database = await createDatabase({ mode: "memory" });

    try {
      await migrateDatabase(database);
      await seedDemoData(database);
      const repository = new PGliteAuditRepository(database);
      const account = (await repository.listAccounts())[0];
      const audit = await repository.createAudit({
        id: "audit-transition",
        accountId: account.id,
        sourceVideoPath: "uploads/audit-transition.mp4",
        provider: "fixture",
        model: "fixture-v1",
      });

      await expect(
        repository.transitionAudit(audit.id, "completed"),
      ).rejects.toMatchObject({ code: "INVALID_AUDIT_TRANSITION" });

      await repository.transitionAudit(audit.id, "uploading");
      await repository.recoverAbandonedAudits();

      await expect(repository.getAudit(audit.id)).resolves.toMatchObject({
        status: "failed",
        errorCode: "ABANDONED_AUDIT",
      });
    } finally {
      await database.close();
    }
  });
});

describe("local media storage", () => {
  it("uses generated paths inside the configured directory and rejects traversal", async () => {
    const directory = await createTemporaryDirectory("shelf-audit-media-");
    const mediaStore = new LocalMediaStore({ directory, maxBytes: 1024 });

    const stored = await mediaStore.saveSourceVideo({
      originalFilename: "aisle walk.MP4",
      mimeType: "video/mp4",
      bytes: Buffer.from("video bytes"),
    });

    expect(stored.mediaPath).toMatch(/^uploads\/[a-f0-9-]+\.mp4$/);
    await expect(
      readFile(join(directory, stored.mediaPath), "utf8"),
    ).resolves.toBe("video bytes");
    await expect(mediaStore.resolveMediaPath("../secrets.mp4")).rejects.toThrow(
      "outside the managed media directory",
    );
  });
});
