import { mkdir } from "node:fs/promises";

import {
  pipeline,
  type ObjectDetectionPipeline,
} from "@huggingface/transformers";
import sharp from "sharp";

import type { CandidateFrame } from "../video/types.js";

export const DEFAULT_DETECTOR_MODEL = "Xenova/detr-resnet-50";

export type PixelBox = {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
};

export type NormalizedBox = {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
};

export type LocalDetection = {
  frameId: string;
  label: string;
  confidence: number;
  region: NormalizedBox;
};

export interface LocalDetector {
  readonly version: string;
  detect(frame: CandidateFrame): Promise<LocalDetection[]>;
}

export class DetectorUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DetectorUnavailableError";
  }
}

export type DetectorRun = {
  available: boolean;
  version: string;
  warnings: string[];
  detections: LocalDetection[];
};

const RELEVANT_SHELF_LABELS = new Set(["bottle", "cup", "wine glass"]);

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function normalizeDetectionBox(
  box: PixelBox,
  width: number,
  height: number,
): NormalizedBox {
  const xMin = clamp(Math.min(box.xmin, box.xmax) / width);
  const xMax = clamp(Math.max(box.xmin, box.xmax) / width);
  const yMin = clamp(Math.min(box.ymin, box.ymax) / height);
  const yMax = clamp(Math.max(box.ymin, box.ymax) / height);
  return { xMin, yMin, xMax, yMax };
}

export class TransformersLocalDetector implements LocalDetector {
  readonly version: string;
  private detector: Promise<ObjectDetectionPipeline> | undefined;

  constructor(
    private readonly options: {
      cacheDirectory: string;
      modelId?: string;
      threshold?: number;
    },
  ) {
    this.version = options.modelId ?? DEFAULT_DETECTOR_MODEL;
  }

  private async getDetector(): Promise<ObjectDetectionPipeline> {
    if (!this.detector) {
      this.detector = (async () => {
        await mkdir(this.options.cacheDirectory, { recursive: true });
        try {
          return await pipeline("object-detection", this.version, {
            cache_dir: this.options.cacheDirectory,
            dtype: "q8",
          });
        } catch (error) {
          throw new DetectorUnavailableError(
            `Unable to initialize ${this.version}: ${error instanceof Error ? error.message : "unknown error"}`,
          );
        }
      })();
    }
    return this.detector;
  }

  async detect(frame: CandidateFrame): Promise<LocalDetection[]> {
    if (!frame.filePath) {
      throw new DetectorUnavailableError("Frame file path is unavailable.");
    }
    const detector = await this.getDetector();
    try {
      const metadata = await sharp(frame.filePath).metadata();
      if (!metadata.width || !metadata.height) {
        throw new Error("Frame dimensions are unavailable.");
      }
      const output = await detector(frame.filePath, {
        threshold: this.options.threshold ?? 0.35,
      });
      return output
        .filter((item) => RELEVANT_SHELF_LABELS.has(item.label))
        .map((item) => ({
          frameId: frame.frameId,
          label: item.label,
          confidence: item.score,
          region: normalizeDetectionBox(
            item.box,
            metadata.width,
            metadata.height,
          ),
        }))
        .filter(
          (item) =>
            item.region.xMax > item.region.xMin &&
            item.region.yMax > item.region.yMin,
        );
    } catch (error) {
      if (error instanceof DetectorUnavailableError) {
        throw error;
      }
      throw new DetectorUnavailableError(
        `Local detector failed on ${frame.frameId}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }
}

export async function runLocalDetection(
  detector: LocalDetector,
  frames: CandidateFrame[],
): Promise<DetectorRun> {
  try {
    const results = await Promise.all(
      frames.map((frame) => detector.detect(frame)),
    );
    return {
      available: true,
      version: detector.version,
      warnings: [],
      detections: results.flat(),
    };
  } catch (error) {
    return {
      available: false,
      version: detector.version,
      warnings: [
        `Local detector unavailable; continuing without its supporting signal. ${error instanceof Error ? error.message : "Unknown detector error."}`,
      ],
      detections: [],
    };
  }
}
