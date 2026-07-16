import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import {
  selectQualityAwareFrames,
  selectVideoEvidenceFrames,
  scoreFrameQuality,
} from "../src/video/frame-selector.js";
import {
  normalizeDetectionBox,
  runLocalDetection,
} from "../src/perception/index.js";
const temporaryDirectories: string[] = [];

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

  it("retains one frame per second and bounds longer-video inference", async () => {
    const clearPath = await createImage("coverage.png", {
      brightness: 0.6,
      pattern: true,
    });
    const frames = Array.from({ length: 30 }, (_, index) => ({
      frameId: `frame-${index}`,
      timestampMs: index * 500,
      fileName: `frame-${index}.png`,
      filePath: clearPath,
    }));
    const selection = await selectVideoEvidenceFrames(frames);

    expect(selection.retainedFrames).toHaveLength(15);
    expect(selection.inferenceFrames).toHaveLength(12);
    expect(selection.inferenceFrames[0].timestampMs).toBe(0);
    expect(selection.inferenceFrames.at(-1)?.timestampMs).toBe(14_000);
    expect(selection.qualityStatus).toBe("usable");
  });

  it("analyzes every retained second of a nine-second video", async () => {
    const clearPath = await createImage("nine-seconds.png", {
      brightness: 0.6,
      pattern: true,
    });
    const selection = await selectVideoEvidenceFrames(
      Array.from({ length: 18 }, (_, index) => ({
        frameId: `frame-${index}`,
        timestampMs: index * 500,
        fileName: `frame-${index}.png`,
        filePath: clearPath,
      })),
    );

    expect(selection.retainedFrames).toHaveLength(9);
    expect(selection.inferenceFrames).toHaveLength(9);
    expect(selection.inferenceFrames[0].timestampMs).toBe(0);
    expect(selection.inferenceFrames.at(-1)?.timestampMs).toBe(8_000);
  });

  it("marks evidence as degraded when a second has no usable candidate", async () => {
    const clearPath = await createImage("clear-quality.png", {
      brightness: 0.6,
      pattern: true,
    });
    const blurredPath = await createImage("blurred-quality.png", {
      brightness: 0.6,
      pattern: true,
      blur: 8,
    });
    const selection = await selectVideoEvidenceFrames([
      {
        frameId: "clear",
        timestampMs: 0,
        fileName: "clear.png",
        filePath: clearPath,
      },
      {
        frameId: "blurred",
        timestampMs: 1_000,
        fileName: "blurred.png",
        filePath: blurredPath,
      },
    ]);

    expect(selection.qualityStatus).toBe("degraded");
    expect(selection.qualityWarnings.join(" ")).toContain("lacked a usable");
  });

  it("marks evidence as unusable when every retained frame is blurry", async () => {
    const blurredPath = await createImage("all-blurred.png", {
      brightness: 0.6,
      pattern: true,
      blur: 8,
    });
    const selection = await selectVideoEvidenceFrames([
      {
        frameId: "one",
        timestampMs: 0,
        fileName: "one.png",
        filePath: blurredPath,
      },
      {
        frameId: "two",
        timestampMs: 1_000,
        fileName: "two.png",
        filePath: blurredPath,
      },
    ]);

    expect(selection.qualityStatus).toBe("unusable");
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
});
