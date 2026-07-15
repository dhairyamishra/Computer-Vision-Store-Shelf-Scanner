import type { CandidateFrame } from "./types.js";

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
