import sharp from "sharp";

import type { CandidateFrame } from "./types.js";

export type FrameQualityScore = {
  sharpness: number;
  brightness: number;
  clipping: number;
  entropy: number;
  score: number;
  reasons: string[];
};

export type SelectedFrame = CandidateFrame & {
  selection: FrameQualityScore & { reasons: string[] };
};

type ScoredFrame = {
  frame: CandidateFrame;
  quality: FrameQualityScore;
  fingerprint: Uint8Array;
};

const UNDEREXPOSED_BRIGHTNESS = 0.12;
const OVEREXPOSED_BRIGHTNESS = 0.9;
const DUPLICATE_DISTANCE = 0.035;
const DUPLICATE_MAX_GAP_MS = 750;

function normalizedEntropy(histogram: number[], count: number): number {
  const entropy = histogram.reduce((total, bucket) => {
    if (bucket === 0) {
      return total;
    }
    const probability = bucket / count;
    return total - probability * Math.log2(probability);
  }, 0);
  return entropy / 8;
}

function qualityScore(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: number,
): FrameQualityScore {
  const histogram = Array.from({ length: 256 }, () => 0);
  let total = 0;
  let clipped = 0;
  let laplacianTotal = 0;
  let laplacianSquaredTotal = 0;
  let laplacianCount = 0;

  for (let index = 0; index < pixels.length; index += channels) {
    const value = pixels[index];
    histogram[value] += 1;
    total += value;
    if (value <= 5 || value >= 250) {
      clipped += 1;
    }
  }

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * channels;
      const laplacian =
        4 * pixels[index] -
        pixels[index - channels] -
        pixels[index + channels] -
        pixels[index - width * channels] -
        pixels[index + width * channels];
      laplacianTotal += laplacian;
      laplacianSquaredTotal += laplacian * laplacian;
      laplacianCount += 1;
    }
  }

  const pixelCount = pixels.length / channels;
  const brightness = total / pixelCount / 255;
  const clipping = clipped / pixelCount;
  const entropy = normalizedEntropy(histogram, pixelCount);
  const laplacianMean = laplacianTotal / Math.max(1, laplacianCount);
  const sharpness = Math.max(
    0,
    (laplacianSquaredTotal / Math.max(1, laplacianCount) -
      laplacianMean * laplacianMean) /
      (255 * 255),
  );
  const exposure =
    brightness < UNDEREXPOSED_BRIGHTNESS
      ? brightness / UNDEREXPOSED_BRIGHTNESS
      : brightness > OVEREXPOSED_BRIGHTNESS
        ? (1 - brightness) / (1 - OVEREXPOSED_BRIGHTNESS)
        : 1;
  // The Laplacian variance is normalized to 8-bit pixels. Keeping it on its
  // natural scale avoids saturating both a focused frame and a heavily blurred
  // one at the same maximum score.
  const sharpnessScore = Math.min(1, sharpness);
  const baseScore = Math.max(
    0,
    Math.min(
      1,
      0.35 * sharpnessScore +
        0.1 * entropy +
        0.5 * exposure +
        0.05 * (1 - clipping),
    ),
  );
  // Exposure is a hard usability constraint: texture in an almost-black frame
  // should not allow it to outrank a normally exposed shelf view.
  const score = baseScore * (0.2 + 0.8 * exposure) * (1 - 0.5 * clipping);
  const reasons = ["temporal coverage"];
  if (brightness < UNDEREXPOSED_BRIGHTNESS) {
    reasons.push("underexposed");
  } else if (brightness > OVEREXPOSED_BRIGHTNESS) {
    reasons.push("overexposed");
  }
  if (sharpnessScore < 0.08) {
    reasons.push("blurry");
  }
  if (clipping > 0.2) {
    reasons.push("high clipping");
  }
  return { sharpness, brightness, clipping, entropy, score, reasons };
}

async function readFrame(path: string): Promise<{
  pixels: Uint8Array;
  width: number;
  height: number;
  channels: number;
  fingerprint: Uint8Array;
}> {
  const image = sharp(path).rotate().greyscale();
  const { data, info } = await image
    .raw()
    .toBuffer({ resolveWithObject: true });
  const fingerprint = await sharp(path)
    .rotate()
    .resize(16, 16, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
  return {
    pixels: data,
    width: info.width,
    height: info.height,
    channels: info.channels,
    fingerprint,
  };
}

export async function scoreFrameQuality(
  path: string,
): Promise<FrameQualityScore> {
  const frame = await readFrame(path);
  return qualityScore(frame.pixels, frame.width, frame.height, frame.channels);
}

function fingerprintDistance(left: Uint8Array, right: Uint8Array): number {
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference += Math.abs(left[index] - right[index]);
  }
  return difference / (left.length * 255);
}

async function scoreFrames(frames: CandidateFrame[]): Promise<ScoredFrame[]> {
  return Promise.all(
    frames.map(async (frame) => {
      if (!frame.filePath) {
        return {
          frame,
          quality: {
            sharpness: 0,
            brightness: 0.5,
            clipping: 0,
            entropy: 0,
            score: 0,
            reasons: ["temporal coverage; image quality was unavailable"],
          },
          fingerprint: new Uint8Array(),
        };
      }
      const image = await readFrame(frame.filePath);
      return {
        frame,
        quality: qualityScore(
          image.pixels,
          image.width,
          image.height,
          image.channels,
        ),
        fingerprint: image.fingerprint,
      };
    }),
  );
}

function deduplicate(scored: ScoredFrame[]): ScoredFrame[] {
  const kept: ScoredFrame[] = [];
  for (const candidate of scored) {
    const duplicateOf = kept.find(
      (existing) =>
        existing.fingerprint.length > 0 &&
        Math.abs(existing.frame.timestampMs - candidate.frame.timestampMs) <=
          DUPLICATE_MAX_GAP_MS &&
        fingerprintDistance(existing.fingerprint, candidate.fingerprint) <
          DUPLICATE_DISTANCE,
    );
    if (!duplicateOf) {
      kept.push(candidate);
    } else if (candidate.quality.score > duplicateOf.quality.score) {
      kept.splice(kept.indexOf(duplicateOf), 1, candidate);
    }
  }
  return kept;
}

/**
 * Scores all available frames, removes visual duplicates, then picks the best
 * frame from each temporal segment. It deliberately retains overview coverage
 * instead of choosing only the globally sharpest moment.
 */
export async function selectQualityAwareFrames(
  frames: CandidateFrame[],
  maximumFrames = 8,
): Promise<SelectedFrame[]> {
  if (frames.length === 0 || maximumFrames <= 0) {
    return [];
  }
  const unique = deduplicate(await scoreFrames(frames));
  const selectionCount = Math.min(maximumFrames, unique.length);
  const firstTimestamp = unique[0].frame.timestampMs;
  const lastTimestamp = unique.at(-1)?.frame.timestampMs ?? firstTimestamp;
  const duration = Math.max(1, lastTimestamp - firstTimestamp);
  const selected: ScoredFrame[] = [];

  for (let segment = 0; segment < selectionCount; segment += 1) {
    const start = segment / selectionCount;
    const end = (segment + 1) / selectionCount;
    const candidates = unique.filter((candidate) => {
      const position =
        (candidate.frame.timestampMs - firstTimestamp) / duration;
      return (
        position >= start &&
        (segment === selectionCount - 1 ? position <= end : position < end)
      );
    });
    const fallback = unique.filter(
      (candidate) => !selected.includes(candidate),
    );
    const best = [...(candidates.length > 0 ? candidates : fallback)].sort(
      (left, right) => right.quality.score - left.quality.score,
    )[0];
    if (best && !selected.includes(best)) {
      selected.push(best);
    }
  }

  return selected
    .sort((left, right) => left.frame.timestampMs - right.frame.timestampMs)
    .map(({ frame, quality }) => ({
      ...frame,
      selection: {
        ...quality,
        reasons: [...quality.reasons, "best quality in temporal segment"],
      },
    }));
}

/** Backwards-compatible temporal-only selector for callers without local files. */
export function selectRepresentativeFrames(
  frames: CandidateFrame[],
  maximumFrames = 8,
): CandidateFrame[] {
  if (frames.length <= maximumFrames) {
    return frames;
  }
  return Array.from({ length: maximumFrames }, (_, index) => {
    const frameIndex = Math.round(
      (index * (frames.length - 1)) / (maximumFrames - 1),
    );
    return frames[frameIndex];
  });
}
