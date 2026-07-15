import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import sharp from "sharp";

import type { CandidateFrame } from "../video/types.js";
import type { LocalDetection } from "./local-detector.js";

export type DetectionCrop = {
  frameId: string;
  label: string;
  fileName: string;
};

/** Creates a small number of detector-guided crops while preserving all overview frames. */
export async function createDetectionCrops(
  frames: CandidateFrame[],
  detections: LocalDetection[],
  outputDirectory: string,
  maximumCrops = 4,
): Promise<DetectionCrop[]> {
  await mkdir(outputDirectory, { recursive: true });
  const framesById = new Map(frames.map((frame) => [frame.frameId, frame]));
  const candidates = [...detections]
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, maximumCrops);
  const crops: DetectionCrop[] = [];
  for (const [index, detection] of candidates.entries()) {
    const frame = framesById.get(detection.frameId);
    if (!frame?.filePath) {
      continue;
    }
    const metadata = await sharp(frame.filePath).metadata();
    if (!metadata.width || !metadata.height) {
      continue;
    }
    const left = Math.floor(detection.region.xMin * metadata.width);
    const top = Math.floor(detection.region.yMin * metadata.height);
    const width = Math.max(
      1,
      Math.ceil(
        (detection.region.xMax - detection.region.xMin) * metadata.width,
      ),
    );
    const height = Math.max(
      1,
      Math.ceil(
        (detection.region.yMax - detection.region.yMin) * metadata.height,
      ),
    );
    const fileName = `crop-${frame.frameId}-${index + 1}.jpg`;
    await sharp(frame.filePath)
      .extract({
        left,
        top,
        width: Math.min(width, metadata.width - left),
        height: Math.min(height, metadata.height - top),
      })
      .jpeg({ quality: 85 })
      .toFile(join(outputDirectory, fileName));
    crops.push({ frameId: frame.frameId, label: detection.label, fileName });
  }
  return crops;
}
