import sharp from "sharp";

import type { CandidateFrame } from "./types.js";

export type FrameQualityScore = {
  sharpness: number;
  brightness: number;
  clipping: number;
  entropy: number;
  score: number;
  sceneChange?: number;
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
const BLURRY_SHARPNESS = 0.002;

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
  if (sharpnessScore < BLURRY_SHARPNESS) {
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

function isUsable(quality: FrameQualityScore): boolean {
  return !quality.reasons.some((reason) =>
    ["blurry", "underexposed", "overexposed", "high clipping"].includes(reason),
  );
}

function asSelected(
  scored: ScoredFrame,
  reasons: string[],
  sceneChange?: number,
): SelectedFrame {
  return {
    ...scored.frame,
    selection: {
      ...scored.quality,
      ...(sceneChange === undefined ? {} : { sceneChange }),
      reasons: [...scored.quality.reasons, ...reasons],
    },
  };
}

export type VideoEvidenceSelection = {
  retainedFrames: SelectedFrame[];
  inferenceFrames: SelectedFrame[];
  qualityStatus: "usable" | "degraded" | "unusable";
  qualityWarnings: string[];
};

function selectBestPerSecond(scored: ScoredFrame[]): ScoredFrame[] {
  const groups = new Map<number, ScoredFrame[]>();
  for (const candidate of scored) {
    const second = Math.floor(candidate.frame.timestampMs / 1_000);
    groups.set(second, [...(groups.get(second) ?? []), candidate]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([second, candidates]) => {
      const usable = candidates.filter((candidate) =>
        isUsable(candidate.quality),
      );
      const best = [...(usable.length > 0 ? usable : candidates)].sort(
        (left, right) => right.quality.score - left.quality.score,
      )[0];
      return {
        ...best,
        quality: {
          ...best.quality,
          reasons: [
            ...best.quality.reasons,
            usable.length > 0
              ? `best usable frame for second ${second}`
              : `best available frame for second ${second}`,
          ],
        },
      };
    });
}

function selectInferenceFrames(retained: ScoredFrame[], maximumFrames: number) {
  if (retained.length <= maximumFrames) {
    return retained.map((frame, index) =>
      asSelected(
        frame,
        ["selected for full-duration coverage"],
        index === 0
          ? 0
          : fingerprintDistance(
              retained[index - 1].fingerprint,
              frame.fingerprint,
            ),
      ),
    );
  }

  const selected = new Map<number, SelectedFrame>();
  selected.set(
    0,
    asSelected(retained[0], ["selected as first evidence frame"], 0),
  );
  const lastIndex = retained.length - 1;
  selected.set(
    lastIndex,
    asSelected(
      retained[lastIndex],
      ["selected as last evidence frame"],
      fingerprintDistance(
        retained[lastIndex - 1].fingerprint,
        retained[lastIndex].fingerprint,
      ),
    ),
  );
  const interiorBuckets = Math.max(0, maximumFrames - selected.size);
  for (let bucket = 0; bucket < interiorBuckets; bucket += 1) {
    const start =
      1 + Math.floor((bucket * (retained.length - 2)) / interiorBuckets);
    const end = Math.max(
      start + 1,
      1 + Math.floor(((bucket + 1) * (retained.length - 2)) / interiorBuckets),
    );
    const candidates = retained.slice(start, end);
    const chosen = candidates
      .map((candidate, index) => {
        const retainedIndex = start + index;
        const sceneChange = fingerprintDistance(
          retained[retainedIndex - 1].fingerprint,
          candidate.fingerprint,
        );
        return { candidate, sceneChange };
      })
      .sort(
        (left, right) =>
          right.sceneChange * 0.7 +
          right.candidate.quality.score * 0.3 -
          (left.sceneChange * 0.7 + left.candidate.quality.score * 0.3),
      )[0];
    if (chosen) {
      const retainedIndex = retained.indexOf(chosen.candidate);
      selected.set(
        retainedIndex,
        asSelected(
          chosen.candidate,
          ["selected for temporal coverage and scene change"],
          chosen.sceneChange,
        ),
      );
    }
  }
  return [...selected.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, frame]) => frame);
}

export async function selectVideoEvidenceFrames(
  frames: CandidateFrame[],
  maximumFrames = 12,
): Promise<VideoEvidenceSelection> {
  if (frames.length === 0) {
    return {
      retainedFrames: [],
      inferenceFrames: [],
      qualityStatus: "unusable",
      qualityWarnings: [
        "No evidence frames could be extracted from the video.",
      ],
    };
  }
  const retained = selectBestPerSecond(await scoreFrames(frames));
  const unusableFrames = retained.filter((frame) => !isUsable(frame.quality));
  const retainedFrames = retained.map((frame) => asSelected(frame, []));
  const qualityStatus =
    unusableFrames.length === retained.length
      ? "unusable"
      : unusableFrames.length > 0
        ? "degraded"
        : "usable";
  const qualityWarnings =
    unusableFrames.length === 0
      ? []
      : [
          `${unusableFrames.length} one-second interval(s) lacked a usable frame.`,
          ...unusableFrames.slice(0, 10).map((frame) => {
            const second = Math.floor(frame.frame.timestampMs / 1_000);
            return `Second ${second}: ${frame.quality.reasons.filter((reason) => reason !== "temporal coverage").join(", ")}.`;
          }),
        ];
  return {
    retainedFrames,
    inferenceFrames: selectInferenceFrames(retained, maximumFrames),
    qualityStatus,
    qualityWarnings,
  };
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
  return (await selectVideoEvidenceFrames(frames, maximumFrames))
    .inferenceFrames;
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
