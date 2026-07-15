import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import {
  selectQualityAwareFrames,
  scoreFrameQuality,
} from "../src/video/frame-selector.js";
import {
  DetectorUnavailableError,
  normalizeDetectionBox,
  runLocalDetection,
  type LocalDetector,
} from "../src/perception/index.js";
import { createApiServer } from "../src/server/index.js";

const temporaryDirectories: string[] = [];
const fixturePath = fileURLToPath(
  new URL("./fixtures/three-colors.mp4", import.meta.url),
);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await (
        await import("node:fs/promises")
      ).rm(directory, {
        recursive: true,
        force: true,
      });
    }),
  );
});

async function createImage(
  fileName: string,
  options: { brightness: number; blur?: number; pattern?: boolean },
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "shelf-audit-quality-"));
  temporaryDirectories.push(directory);
  const path = join(directory, fileName);
  const background = Math.round(options.brightness * 255);
  const image = sharp({
    create: {
      width: 160,
      height: 90,
      channels: 3,
      background: { r: background, g: background, b: background },
    },
  }).composite(
    options.pattern
      ? [
          {
            input: Buffer.from(
              '<svg width="160" height="90" xmlns="http://www.w3.org/2000/svg"><pattern id="s" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="4" height="8" fill="rgb(192,192,192)"/><rect x="4" width="4" height="8" fill="rgb(64,64,64)"/></pattern><rect width="160" height="90" fill="url(#s)"/></svg>',
            ),
          },
        ]
      : [],
  );
  const rendered = await image
    .modulate({ brightness: options.brightness / 0.6 })
    .png()
    .toBuffer();
  const output = sharp(rendered);
  await (options.blur ? output.blur(options.blur) : output).png().toFile(path);
  return path;
}

function multipartPayload(video: Buffer) {
  const boundary = "shelf-audit-perception-boundary";
  return {
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="accountId"\r\n\r\naccount-northside-market\r\n--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="fixture.mp4"\r\nContent-Type: video/mp4\r\n\r\n`,
      ),
      video,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe("quality-aware frame selection", () => {
  it("ranks a clear, exposed frame above dark and blurred synthetic frames", async () => {
    const clearPath = await createImage("clear.png", {
      brightness: 0.6,
      pattern: true,
      blur: 0.3,
    });
    const darkPath = await createImage("dark.png", {
      brightness: 0.03,
      pattern: false,
    });
    const blurredPath = await createImage("blurred.png", {
      brightness: 0.6,
      pattern: true,
      blur: 8,
    });

    const [clear, dark, blurred] = await Promise.all([
      scoreFrameQuality(clearPath),
      scoreFrameQuality(darkPath),
      scoreFrameQuality(blurredPath),
    ]);
    expect(clear.score).toBeGreaterThan(dark.score);
    expect(clear.score).toBeGreaterThan(blurred.score);
    expect(dark.reasons).toContain("underexposed");
    expect(blurred.reasons).toContain("blurry");
  });

  it("removes near duplicates while preserving early, middle, and late coverage", async () => {
    const earlyPath = await createImage("early.png", {
      brightness: 0.6,
      pattern: true,
    });
    const middlePath = await createImage("middle.png", {
      brightness: 0.55,
      pattern: true,
    });
    const latePath = await createImage("late.png", {
      brightness: 0.5,
      pattern: true,
    });
    const selected = await selectQualityAwareFrames(
      [
        {
          frameId: "early",
          timestampMs: 0,
          fileName: "early.png",
          filePath: earlyPath,
        },
        {
          frameId: "early-duplicate",
          timestampMs: 200,
          fileName: "early-duplicate.png",
          filePath: earlyPath,
        },
        {
          frameId: "middle",
          timestampMs: 1_000,
          fileName: "middle.png",
          filePath: middlePath,
        },
        {
          frameId: "late",
          timestampMs: 2_000,
          fileName: "late.png",
          filePath: latePath,
        },
      ],
      3,
    );

    expect(selected.map((frame) => frame.frameId)).toEqual([
      "early",
      "middle",
      "late",
    ]);
    expect(selected.every((frame) => frame.selection.reasons.length > 0)).toBe(
      true,
    );
  });
});

describe("local detector boundary", () => {
  it("normalizes boxes and retains generic detector labels without SKU mapping", async () => {
    expect(
      normalizeDetectionBox(
        { xmin: -10, ymin: 20, xmax: 230, ymax: 80 },
        200,
        100,
      ),
    ).toEqual({ xMin: 0, yMin: 0.2, xMax: 1, yMax: 0.8 });
    const result = await runLocalDetection(
      {
        version: "test-detector",
        detect: async () => [
          {
            frameId: "frame-1",
            label: "bottle",
            confidence: 0.9,
            region: { xMin: 0, yMin: 0.2, xMax: 1, yMax: 0.8 },
          },
        ],
      },
      [{ frameId: "frame-1", timestampMs: 0, fileName: "frame-1.png" }],
    );
    expect(result.detections[0]).toEqual({
      frameId: "frame-1",
      label: "bottle",
      confidence: 0.9,
      region: { xMin: 0, yMin: 0.2, xMax: 1, yMax: 0.8 },
    });
    expect(result.detections[0]).not.toHaveProperty("productId");
  });

  it("completes fixture processing with a detector-unavailable warning", async () => {
    const unavailableDetector: LocalDetector = {
      version: "Xenova/detr-resnet-50",
      detect: async () => {
        throw new DetectorUnavailableError("Model download unavailable.");
      },
    };
    const server = await createApiServer({
      mode: "test",
      localDetector: unavailableDetector,
    });
    try {
      const upload = multipartPayload(
        await (await import("node:fs/promises")).readFile(fixturePath),
      );
      const created = await server.inject({
        method: "POST",
        url: "/audits",
        payload: upload.payload,
        headers: { "content-type": upload.contentType },
      });
      expect(created.statusCode).toBe(201);
      const audit = await server.inject({
        method: "GET",
        url: `/audits/${created.json<{ auditId: string }>().auditId}`,
      });
      expect(audit.json()).toMatchObject({
        status: "completed",
        finalAudit: {
          captureQuality: {
            warnings: expect.arrayContaining([
              expect.stringContaining("Local detector unavailable"),
            ]),
          },
          provenance: { detectorVersion: "Xenova/detr-resnet-50" },
        },
        processingMetadata: {
          detector: { available: false, version: "Xenova/detr-resnet-50" },
        },
      });
    } finally {
      await server.close();
    }
  });
});
