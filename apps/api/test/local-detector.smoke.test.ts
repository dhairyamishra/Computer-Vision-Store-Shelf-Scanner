import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_DETECTOR_MODEL,
  TransformersLocalDetector,
} from "../src/perception/index.js";
import { FfmpegVideoProcessor } from "../src/video/index.js";

const fixturePath = fileURLToPath(
  new URL("./fixtures/three-colors.mp4", import.meta.url),
);
const smokeTest =
  process.env.npm_lifecycle_event === "test:detector:smoke" ? it : it.skip;

describe("local detector smoke test", () => {
  smokeTest(
    "loads quantized DETR and runs it on an extracted video frame",
    async () => {
      const frameDirectory = await mkdtemp(join(tmpdir(), "shelf-audit-detr-"));
      try {
        const processor = new FfmpegVideoProcessor();
        const frames = await processor.extractFrames(fixturePath, {
          outputDirectory: frameDirectory,
        });
        const detector = new TransformersLocalDetector({
          cacheDirectory: resolve("data", "model-cache"),
        });
        const detections = await detector.detect(frames[0]);

        expect(detector.version).toBe(DEFAULT_DETECTOR_MODEL);
        expect(
          detections.every(
            (detection) =>
              detection.label.length > 0 &&
              detection.region.xMin >= 0 &&
              detection.region.xMax <= 1,
          ),
        ).toBe(true);
      } finally {
        await rm(frameDirectory, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
