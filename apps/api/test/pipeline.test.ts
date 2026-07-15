import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createApiServer } from "../src/server/index.js";
import { extractFixtureFrames } from "../src/video/index.js";

const fixturePath = fileURLToPath(
  new URL("./fixtures/three-colors.mp4", import.meta.url),
);

function multipartPayload(fields: Record<string, string>, video: Buffer) {
  const boundary = "shelf-audit-test-boundary";
  const fieldParts = Object.entries(fields).map(
    ([name, value]) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
  );
  const fileHeader =
    `--${boundary}\r\n` +
    'Content-Disposition: form-data; name="video"; filename="three-colors.mp4"\r\n' +
    "Content-Type: video/mp4\r\n\r\n";
  const payload = Buffer.concat([
    Buffer.from(fieldParts.join("")),
    Buffer.from(fileHeader),
    video,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  return {
    payload,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe("video processing", () => {
  it("extracts timestamped frames from the committed tiny video fixture", async () => {
    const frames = await extractFixtureFrames(fixturePath);

    expect(frames.metadata.durationMs).toBeGreaterThan(1_000);
    expect(frames.frames).toHaveLength(3);
    expect(frames.frames.map((frame) => frame.timestampMs)).toEqual([
      0, 1_000, 2_000,
    ]);
    expect(
      frames.frames.every((frame) => frame.fileName.includes("frame-")),
    ).toBe(true);
  });
});

describe("Fastify audit API", () => {
  it("serves health and account context", async () => {
    const server = await createApiServer({ mode: "test" });
    try {
      await expect(
        server.inject({ method: "GET", url: "/health" }),
      ).resolves.toMatchObject({
        statusCode: 200,
        json: expect.any(Function),
      });
      await expect(
        server.inject({ method: "GET", url: "/accounts" }),
      ).resolves.toMatchObject({
        statusCode: 200,
      });
    } finally {
      await server.close();
    }
  });

  it("rejects malformed and oversized uploads with stable errors", async () => {
    const server = await createApiServer({ mode: "test", maxUploadBytes: 8 });
    try {
      const malformed = await server.inject({
        method: "POST",
        url: "/audits",
        payload: "not multipart",
        headers: { "content-type": "text/plain" },
      });
      expect(malformed.statusCode).toBe(415);
      expect(malformed.json()).toMatchObject({
        error: { code: "UNSUPPORTED_MEDIA_TYPE" },
      });

      const video = await readFile(fixturePath);
      const oversized = multipartPayload(
        { accountId: "account-northside-market" },
        video,
      );
      const oversizedResponse = await server.inject({
        method: "POST",
        url: "/audits",
        payload: oversized.payload,
        headers: { "content-type": oversized.contentType },
      });
      expect(oversizedResponse.statusCode).toBe(413);
      expect(oversizedResponse.json()).toMatchObject({
        error: { code: "UPLOAD_TOO_LARGE" },
      });
    } finally {
      await server.close();
    }
  });

  it("persists a schema-valid fixture audit and marks a failed processing stage", async () => {
    const server = await createApiServer({ mode: "test" });
    try {
      const video = await readFile(fixturePath);
      const upload = multipartPayload(
        { accountId: "account-northside-market" },
        video,
      );
      const response = await server.inject({
        method: "POST",
        url: "/audits",
        payload: upload.payload,
        headers: { "content-type": upload.contentType },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ status: "completed" });
      const auditId = response.json<{ auditId: string }>().auditId;
      const audit = await server.inject({
        method: "GET",
        url: `/audits/${auditId}`,
      });
      expect(audit.statusCode).toBe(200);
      expect(audit.json()).toMatchObject({
        status: "completed",
        stageLatencies: { totalMs: expect.any(Number) },
        finalAudit: { auditId, schemaVersion: "1.0" },
      });

      const failingServer = await createApiServer({
        mode: "test",
        videoProcessor: {
          inspect: async () => {
            throw new Error("ffprobe unavailable");
          },
          extractFrames: async () => [],
        },
      });
      try {
        const failedResponse = await failingServer.inject({
          method: "POST",
          url: "/audits",
          payload: upload.payload,
          headers: { "content-type": upload.contentType },
        });
        expect(failedResponse.statusCode).toBe(500);
        const failedAuditId = failedResponse.json<{ auditId: string }>()
          .auditId;
        const failedAudit = await failingServer.inject({
          method: "GET",
          url: `/audits/${failedAuditId}`,
        });
        expect(failedAudit.json()).toMatchObject({
          status: "failed",
          errorCode: "VIDEO_PROCESSING_FAILED",
        });
      } finally {
        await failingServer.close();
      }
    } finally {
      await server.close();
    }
  });
});
